// ==UserScript==
// @name         BambooHR Timesheet Fill Month
// @namespace    month.timesheet.bamboohr.sconde.net
// @version      2.1
// @description  Fill BambooHR Timesheet month with templates
// @author       Alvaro Gutierrez (forked from Sergio Conde)
// @match        https://*.bamboohr.com/employees/timesheet/*
// @grant        GM_getValue
// @grant        GM_setValue
// @homepageURL  https://github.com/alvarogl/greasemonkey-scripts
// @supportURL   https://github.com/alvarogl/greasemonkey-scripts/issues
// @updateURL    https://raw.githubusercontent.com/alvarogl/greasemonkey-scripts/master/bamboohr-timesheet-month.user.js
// @downloadURL    https://raw.githubusercontent.com/alvarogl/greasemonkey-scripts/master/bamboohr-timesheet-month.user.js
// ==/UserScript==

'use strict';

/*
   Don't touch this, won't persist across updates.
   To configure your own schedule:
   - got to BambooHR in the timesheet section to run the script and generate the defaults
   - go to your extension's dashboard
   - make sure advanced mode is setup (at least in Tampermonkey)
   - go to the script editor, you should see a Storage tab
   - select the Storage tab, you should see the default settings
   - edit them and save
 */
const DEFAULT_TEMPLATES = {
  'default': [
    { start:  '9:00', end: '14:00' },
    { start: '15:00', end: '18:00' }
  ],
  'Fri':     [{ start: '9:00', end: '14:30' }],
  'summer':  [{ start: '8:00', end: '15:00' }],
};
const DEFAULT_ENTROPY_MINUTES = 0;
const SUMMER_MONTHS = ['Jul', 'Aug'];

function random_entropy(amount) {
  // distribute amount around 0
  // - without bias if amount is even
  // - half probability for extreme values if amount is odd
  return Math.floor(Math.random() * (amount + 1) - amount/2)
}

function install(key, dfault) {
  if (!GM_getValue(key)) {
    GM_setValue(key, dfault);
  }
}

function install_defaults() {
  install('TEMPLATES', DEFAULT_TEMPLATES);
  install('ENTROPY_MINUTES', DEFAULT_ENTROPY_MINUTES);
}

async function bamboohr_fetch(method, entries, success_message) {
  if (entries.length === 0) {
    alert('No changes to perform');
    return;
  }
  try {
    const response = await fetch(
      `${window.location.origin}/timesheet/clock/entries`,
      {
        method,
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-csrf-token': unsafeWindow.CSRF_TOKEN
        },
        body: JSON.stringify({ entries })
      }
    )
    if (response.ok) {
      alert(success_message)
      location.reload();
    }
    else {
      const body = await response.text();
      alert(`Request error!\nHTTP Code: ${response.status}\nResponse:\n${body}`)
    }
  }
  catch(err) {
    alert(`Fetch error!\n\n${err}`)
  }
}

function create_entries(entries, skip_list) {
  const success_message = [
    `Created ${entries.length} entries.`,
    `Skipped days:\n${skip_list.join('\n')}`
  ].join('\n\n');
  return bamboohr_fetch('POST', entries, success_message)
}

function delete_entries(entries) {
  const success_message = `Deleted ${entries.length} entries.`;
  return bamboohr_fetch('DELETE', entries, success_message)
}

function get_timesheet_data() {
  return JSON.parse(document.getElementById('js-timesheet-data').innerHTML);
}

function fill_month(e) {
  e.preventDefault();

  const TEMPLATES = GM_getValue('TEMPLATES');
  const ENTROPY_MINUTES = GM_getValue('ENTROPY_MINUTES');

  // HH:MM
  const time_formatter = new Intl.DateTimeFormat(
      undefined,
    {hour: 'numeric', minute: 'numeric', hour12: false}
  )
  // Mon, Tue, Wed, etc
  const weekday_formatter = new Intl.DateTimeFormat(
    'en-US', {weekday: 'short'}
  )
  // Jan, Feb, Mar, etc
  const month_formatter = new Intl.DateTimeFormat(
    'en-US', {month: 'short'}
  )

  const tsd = get_timesheet_data();
  const skip_list = [];
  const entries = [];
  let tracking_id = 0;

  for (const [day, details] of Object.entries(tsd.timesheet.dailyDetails)) {
    const date = new Date(day);

    /* Skip weekend */
    if ([0, 6].includes(date.getDay())) {
      continue;
    }

    /* Skip holidays & time off */
    const skip_reasons = [];

    skip_reasons.push(
      ...details.holidays.map(h => `${h.name.trim()} (${h.paidHours} hours)`)
    );
    skip_reasons.push(
      ...details.timeOff.map(t => `${t.type.trim()} (${t.amount} ${t.unit})`)
    );

    if (skip_reasons.length > 0) {
      skip_list.push(`${day}: ${skip_reasons.join(", ")}`);
      continue;
    }

    /* Get the working time slots for the dow */
    const dow = weekday_formatter.format(date);
    const month = month_formatter.format(date);
    let slots = TEMPLATES.default;

    if (Object.prototype.hasOwnProperty.call(TEMPLATES, dow)) {
      slots = TEMPLATES[dow];
    }

    if (SUMMER_MONTHS.includes(month)) {
      slots = TEMPLATES.summer;
    }
    /* Generate the entries for this day */
    const minute_diff = Array.from(
      {length: slots.length}, () => random_entropy(ENTROPY_MINUTES)
    )

    for (const [idx, slot] of slots.entries()) {
      tracking_id += 1;

      const start = new Date(`${day} ${slot.start}`);
      start.setMinutes(start.getMinutes() + minute_diff.at(idx));

      const end = new Date(`${day} ${slot.end}`);
      end.setMinutes(end.getMinutes() + minute_diff.at(-(idx+1)));

      entries.push({
        id: null,
        trackingId: tracking_id,
        employeeId: unsafeWindow.currentlyEditingEmployeeId,
        date: day,
        start: time_formatter.format(start),
        end: time_formatter.format(end),
        note: ''
      });
    }
  }
  create_entries(entries, skip_list);
}

function delete_month(e) {
  e.preventDefault();

  const tsd = get_timesheet_data();

  /* Grab all entries ids */
  const entries = [];
  for (const details of Object.values(tsd.timesheet.dailyDetails)) {
    for (const entry of details.clockEntries) {
      entries.push(entry.id)
    }
  }
  delete_entries(entries)
}

function add_button(label, onclick, to_clone) {

  const new_button_tree = to_clone.cloneNode(true);
  const btn = new_button_tree.querySelector('button')

  // HACK:
  // when month is filled, the "Clock in" button we clone is disabled
  // changing those few classes seem to solve the problem
  // although it's not very future proof :/
  btn.classList.remove('Mui-disabled', 'jss-q7');
  btn.classList.add('css-pw3xuh');
  btn.removeAttribute('data-bi-id')
  btn.disabled = false;
  btn.tabIndex = 0;
  btn.innerText = label;
  btn.onclick = onclick;

  to_clone.parentElement.append(new_button_tree)
}


/* Here be dragons */
(function () {
  install_defaults();

  const clock_in_button = document.querySelector('[data-bi-id="my-info-timesheet-clock-in-button"]');
  const to_clone = clock_in_button.parentElement;
  add_button('Fill Month', fill_month, to_clone)
  add_button('Delete Month', delete_month, to_clone)
})();

