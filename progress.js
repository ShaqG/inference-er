'use strict';

// Shared by all four cases: the duty roster. It keeps each case's best rating in
// localStorage, renders the roster stars next to the case links, and builds the
// diagnosis block at the end of a debrief.
const ERProgress = (() => {
  const KEY = 'inference-er-roster-v1';
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    // Storage can be unavailable (file:// restrictions, private mode). The roster
    // then just stays empty for the session.
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Same as above: keep playing without persistence.
    }
  }

  function bestFor(id) {
    return data[id]?.stars || 0;
  }

  function record(id, stars) {
    if (bestFor(id) >= stars) return false;
    data[id] = { stars, at: Date.now() };
    save();
    return true;
  }

  function starRow(count) {
    const row = document.createDocumentFragment();
    for (let i = 1; i <= 3; i++) {
      const star = document.createElement('span');
      star.className = i <= count ? 'on' : 'off';
      star.textContent = '★';
      star.setAttribute('aria-hidden', 'true');
      row.append(star);
    }
    return row;
  }

  function renderNav(t) {
    for (const el of document.querySelectorAll('[data-roster]')) {
      const stars = bestFor(el.dataset.roster);
      el.replaceChildren(starRow(stars));
      el.setAttribute('aria-label', t.rosterAria(stars));
    }
  }

  // info: { id, recordable, goals }. Goals are ordered; the first one is the main
  // goal. Stars: one for finishing the case, one for the main goal, one for both.
  // Re-renders never lower a stored best, so language switches stay harmless.
  function renderDiagnosis(el, t, info) {
    const main = info.goals[0].ok;
    const all = info.goals.every(goal => goal.ok);
    const stars = 1 + (main ? 1 : 0) + (all ? 1 : 0);
    const previous = bestFor(info.id);
    const improved = info.recordable && record(info.id, stars);
    el.replaceChildren();
    const head = document.createElement('p');
    head.className = 'diag-head';
    const title = document.createElement('b');
    title.textContent = t.diagTitle;
    const grade = document.createElement('span');
    grade.className = 'diag-stars';
    grade.replaceChildren(starRow(stars));
    grade.setAttribute('aria-label', t.diagStars(stars));
    head.append(title, grade);
    if (info.recordable && previous) {
      const note = document.createElement('span');
      note.className = 'diag-note';
      note.textContent = improved ? t.diagNewBest : t.diagBest(previous);
      head.append(note);
    }
    const list = document.createElement('ul');
    list.className = 'diag-goals';
    for (const goal of info.goals) {
      const item = document.createElement('li');
      item.className = goal.ok ? 'met' : 'missed';
      const mark = document.createElement('b');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = goal.ok ? '✓' : '✗';
      const label = document.createElement('span');
      label.textContent = goal.label;
      const state = document.createElement('i');
      state.textContent = goal.ok ? t.diagMet : t.diagMissed;
      item.append(mark, label, state);
      list.append(item);
    }
    el.append(head, list);
    el.hidden = false;
  }

  return { bestFor, renderNav, renderDiagnosis };
})();
