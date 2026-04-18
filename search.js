(function () {
  'use strict';

  var MAX_RESULTS = 12;
  var MIN_QUERY = 2;
  var DEBOUNCE_MS = 150;

  // State
  var index = null;
  var pages = {};
  var activeFilter = 'all';
  var activeIdx = -1;
  var currentResults = [];
  var currentQuery = '';
  var debounceTimer = null;
  var indexError = false;

  // Base path detection — works from root or /addons/ subdirectory
  var basePath = '';
  var styleLink = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
  if (styleLink) {
    basePath = styleLink.getAttribute('href').replace('style.css', '');
  }

  // DOM refs
  var inputEl, resultsEl, filterBarEl, resultsListEl, emptyEl, loadingEl, fetchErrorEl;

  // ---- Index loading ----

  var indexLoading = false;
  function loadIndex() {
    if (index || indexLoading || indexError) return;
    indexLoading = true;
    if (loadingEl) { loadingEl.hidden = false; showResults(); }
    fetch(basePath + 'search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        index = data;
        data.pages.forEach(function (p) { pages[p.id] = p; });
        indexLoading = false;
        if (loadingEl) loadingEl.hidden = true;
      })
      .catch(function () {
        indexLoading = false;
        indexError = true;
        if (loadingEl) loadingEl.hidden = true;
        if (fetchErrorEl) { fetchErrorEl.hidden = false; showResults(); }
      });
  }

  // ---- Search algorithm ----

  function scoreSection(section, terms) {
    var headingLower = section.heading.toLowerCase();
    var textLower = section.text.toLowerCase();
    var score = 0;

    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hMatch = headingLower.indexOf(term) !== -1;
      var tMatch = textLower.indexOf(term) !== -1;

      if (!hMatch && !tMatch) return 0; // all terms must match

      if (hMatch) {
        score += 10;
        if (headingLower === term) score += 20;
        var hIdx = headingLower.indexOf(term);
        if (hIdx === 0 || /\W/.test(headingLower[hIdx - 1])) score += 5;
      }

      if (tMatch) {
        score += 3;
        var count = 0;
        var pos = 0;
        while ((pos = textLower.indexOf(term, pos)) !== -1 && count < 5) {
          count++;
          pos += term.length;
        }
        score += count;
      }
    }

    return score;
  }

  function search(query) {
    if (!index) return [];
    var trimmed = query.trim().toLowerCase();
    if (trimmed.length < MIN_QUERY) return [];

    var terms = trimmed.split(/\s+/);
    var scored = [];

    for (var i = 0; i < index.sections.length; i++) {
      var section = index.sections[i];
      if (activeFilter !== 'all') {
        var page = pages[section.page];
        if (page && page.addon !== activeFilter) continue;
      }
      var s = scoreSection(section, terms);
      if (s > 0) scored.push({ section: section, score: s });
    }

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, MAX_RESULTS);
  }

  // ---- Snippet generation ----

  function makeSnippet(text, terms) {
    var lower = text.toLowerCase();
    var firstIdx = -1;
    for (var i = 0; i < terms.length; i++) {
      var idx = lower.indexOf(terms[i]);
      if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
    }
    if (firstIdx === -1) firstIdx = 0;

    var start = Math.max(0, firstIdx - 40);
    var end = Math.min(text.length, start + 120);
    var snippet = text.slice(start, end);
    if (start > 0) snippet = '\u2026' + snippet;
    if (end < text.length) snippet = snippet + '\u2026';

    // Highlight terms
    for (var j = 0; j < terms.length; j++) {
      var re = new RegExp('(' + escapeRegex(terms[j]) + ')', 'gi');
      snippet = snippet.replace(re, '<mark>$1</mark>');
    }
    return snippet;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---- Rendering ----

  function renderResults(results) {
    currentResults = results;
    activeIdx = -1;
    resultsListEl.innerHTML = '';

    if (results.length === 0) {
      emptyEl.hidden = false;
      emptyEl.querySelector('.search-empty-query').textContent = currentQuery;
      resultsListEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    resultsListEl.hidden = false;
    var terms = currentQuery.trim().toLowerCase().split(/\s+/);

    for (var i = 0; i < results.length; i++) {
      var sec = results[i].section;
      var page = pages[sec.page];
      var a = document.createElement('a');
      a.className = 'search-result';
      a.setAttribute('role', 'option');
      a.href = basePath + page.url + '#' + sec.anchor;

      var addonSpan = document.createElement('span');
      addonSpan.className = 'result-addon';
      addonSpan.setAttribute('data-addon', page.addon);
      addonSpan.textContent = page.addon;

      var headingSpan = document.createElement('span');
      headingSpan.className = 'result-heading';
      if (sec.level === 3 && sec.parent) {
        var parentSpan = document.createElement('span');
        parentSpan.className = 'result-parent';
        parentSpan.textContent = sec.parent + ' \u203A ';
        headingSpan.appendChild(parentSpan);
      }
      headingSpan.appendChild(document.createTextNode(sec.heading));

      var snippetSpan = document.createElement('span');
      snippetSpan.className = 'result-snippet';
      snippetSpan.innerHTML = makeSnippet(sec.text, terms);

      a.appendChild(addonSpan);
      a.appendChild(headingSpan);
      a.appendChild(snippetSpan);
      resultsListEl.appendChild(a);
    }
  }

  function showResults() {
    resultsEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function hideResults() {
    resultsEl.hidden = true;
    inputEl.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
    clearActiveResult();
  }

  function clearActiveResult() {
    var items = resultsListEl.querySelectorAll('.search-result');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('search-result--active');
    }
  }

  function setActiveResult(idx) {
    clearActiveResult();
    var items = resultsListEl.querySelectorAll('.search-result');
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('search-result--active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- Filter handling ----

  function buildFilterBar() {
    filterBarEl.innerHTML = '';
    var filters = ['All', 'AdminTools', 'Notice Board', 'Mail Delivery', 'Tag Tool', 'General'];
    var values = ['all', 'AdminTools', 'Notice Board', 'Mail Delivery', 'Tag Tool', 'General'];

    for (var i = 0; i < filters.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'search-filter' + (values[i] === activeFilter ? ' active' : '');
      btn.setAttribute('data-addon', values[i]);
      btn.textContent = filters[i];
      btn.type = 'button';
      filterBarEl.appendChild(btn);
    }
  }

  function onFilterClick(e) {
    var btn = e.target.closest('.search-filter');
    if (!btn) return;
    activeFilter = btn.getAttribute('data-addon');
    buildFilterBar();
    if (currentQuery.trim().length >= MIN_QUERY) {
      renderResults(search(currentQuery));
    }
  }

  // ---- Event handlers ----

  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      currentQuery = inputEl.value;
      if (currentQuery.trim().length < MIN_QUERY) {
        hideResults();
        return;
      }
      var results = search(currentQuery);
      renderResults(results);
      showResults();
    }, DEBOUNCE_MS);
  }

  function getFocusableInWrapper() {
    var wrapper = document.querySelector('.search-wrapper');
    if (!wrapper) return [];
    var all = wrapper.querySelectorAll('input, button, a[href], [tabindex]:not([tabindex="-1"])');
    var visible = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].hidden && all[i].offsetParent !== null) visible.push(all[i]);
    }
    return visible;
  }

  function onKeyDown(e) {
    if (!resultsEl || resultsEl.hidden) return;
    var items = resultsListEl.querySelectorAll('.search-result');
    var count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % count;
      setActiveResult(activeIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = activeIdx <= 0 ? count - 1 : activeIdx - 1;
      setActiveResult(activeIdx);
    } else if (e.key === 'Enter' && activeIdx >= 0 && activeIdx < count) {
      e.preventDefault();
      items[activeIdx].click();
      hideResults();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideResults();
      inputEl.blur();
    } else if (e.key === 'Tab') {
      var focusable = getFocusableInWrapper();
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }

  function onFocusIn() {
    if (currentQuery.trim().length >= MIN_QUERY && currentResults.length > 0) {
      showResults();
    }
    // Close mobile nav if open
    var topNav = document.querySelector('.top-nav');
    if (topNav && topNav.classList.contains('open')) {
      topNav.classList.remove('open');
      var toggle = document.querySelector('.nav-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
  }

  function onClickOutside(e) {
    var wrapper = document.querySelector('.search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      hideResults();
    }
  }

  // ---- Global '/' shortcut ----

  function isInputFocused() {
    var tag = document.activeElement && document.activeElement.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (document.activeElement && document.activeElement.isContentEditable);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !isInputFocused()) {
      e.preventDefault();
      if (inputEl) inputEl.focus();
    }
  });

  // ---- Init ----

  function init() {
    inputEl = document.querySelector('.search-input');
    resultsEl = document.querySelector('.search-results');
    if (!inputEl || !resultsEl) return;

    // Build inner structure
    filterBarEl = document.createElement('div');
    filterBarEl.className = 'search-filter-bar';
    resultsEl.appendChild(filterBarEl);

    resultsListEl = document.createElement('div');
    resultsListEl.className = 'search-results-list';
    resultsEl.appendChild(resultsListEl);

    emptyEl = document.createElement('div');
    emptyEl.className = 'search-empty';
    emptyEl.hidden = true;
    emptyEl.innerHTML = 'No results for "<span class="search-empty-query"></span>"';
    resultsEl.appendChild(emptyEl);

    loadingEl = document.createElement('div');
    loadingEl.className = 'search-loading';
    loadingEl.hidden = true;
    loadingEl.setAttribute('aria-live', 'polite');
    loadingEl.textContent = 'Loading search\u2026';
    resultsEl.appendChild(loadingEl);

    fetchErrorEl = document.createElement('div');
    fetchErrorEl.className = 'search-fetch-error';
    fetchErrorEl.hidden = true;
    fetchErrorEl.setAttribute('role', 'alert');
    fetchErrorEl.textContent = 'Search unavailable. Please refresh the page.';
    resultsEl.appendChild(fetchErrorEl);

    buildFilterBar();

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    inputEl.addEventListener('focus', loadIndex, { once: false });
    inputEl.addEventListener('focus', onFocusIn);
    filterBarEl.addEventListener('click', onFilterClick);
    document.addEventListener('click', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
