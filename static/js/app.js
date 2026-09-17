/**
 * BigQuery Release Notes Explorer
 * Vanilla JavaScript implementation
 */

(() => {
  'use strict';

  // --- State ---
  let state = {
    feedData: null,
    entries: [],
    categories: [],
    selectedItem: null,
    selectedCategory: 'ALL',
    searchQuery: '',
    isLoading: false,
    activeHashtags: new Set(['#BigQuery', '#GoogleCloud'])
  };

  // --- DOM Elements ---
  const el = {
    refreshBtn: document.getElementById('refresh-btn'),
    refreshSpinner: document.getElementById('refresh-spinner'),
    refreshIcon: document.getElementById('refresh-icon'),
    refreshBtnLabel: document.getElementById('refresh-btn-label'),
    themeToggle: document.getElementById('theme-toggle'),
    statusText: document.getElementById('status-text'),
    feedStatus: document.getElementById('feed-status'),
    searchInput: document.getElementById('search-input'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    statsSummary: document.getElementById('stats-summary'),
    categoryChips: document.getElementById('category-chips'),
    initialLoader: document.getElementById('initial-loader'),
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-message'),
    errorRetryBtn: document.getElementById('error-retry-btn'),
    emptyState: document.getElementById('empty-state'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    entriesList: document.getElementById('entries-list'),
    selectionBar: document.getElementById('selection-bar'),
    selectionSummary: document.getElementById('selection-summary'),
    barTweetBtn: document.getElementById('bar-tweet-btn'),
    barClearBtn: document.getElementById('bar-clear-btn'),
    tweetModal: document.getElementById('tweet-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalItemCategory: document.getElementById('modal-item-category'),
    modalItemDate: document.getElementById('modal-item-date'),
    modalItemSourceText: document.getElementById('modal-item-source-text'),
    tweetTextarea: document.getElementById('tweet-textarea'),
    charCount: document.getElementById('char-count'),
    charRingProgress: document.getElementById('char-ring-progress'),
    quickTags: document.getElementById('quick-tags'),
    modalCopyBtn: document.getElementById('modal-copy-btn'),
    modalTweetBtn: document.getElementById('modal-tweet-btn'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message')
  };

  const MAX_TWEET_LENGTH = 280;
  const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 10; // r = 10 -> ~62.83

  // Initialize progress circle stroke
  if (el.charRingProgress) {
    el.charRingProgress.style.strokeDasharray = `${CIRCLE_CIRCUMFERENCE} ${CIRCLE_CIRCUMFERENCE}`;
    el.charRingProgress.style.strokeDashoffset = '0';
  }

  // --- Helpers ---
  function showToast(msg, duration = 3000) {
    el.toastMessage.textContent = msg;
    el.toast.classList.remove('hidden');
    if (el.toast._timer) clearTimeout(el.toast._timer);
    el.toast._timer = setTimeout(() => {
      el.toast.classList.add('hidden');
    }, duration);
  }

  function getCategoryClass(category) {
    const cat = (category || '').toLowerCase().trim();
    if (cat.includes('feature')) return 'cat-feature';
    if (cat.includes('change')) return 'cat-change';
    if (cat.includes('fixed') || cat.includes('fix')) return 'cat-fixed';
    if (cat.includes('deprecat')) return 'cat-deprecated';
    if (cat.includes('security')) return 'cat-security';
    if (cat.includes('issue')) return 'cat-issue';
    if (cat.includes('announc')) return 'cat-announcement';
    return 'cat-change';
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  // --- API Fetching ---
  async function fetchReleaseNotes(forceRefresh = false) {
    if (state.isLoading) return;
    setLoadingState(true, forceRefresh);

    try {
      const url = forceRefresh ? '/api/release-notes?refresh=true' : '/api/release-notes';
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to fetch release notes.');
      }

      state.feedData = json.data;
      state.entries = json.data.entries || [];
      state.categories = json.data.categories || [];

      // Update Header Status
      const cachedText = json.data.cached ? '(cached)' : '(live)';
      const timeStr = formatTime(json.data.fetched_at);
      el.statusText.textContent = `Updated ${timeStr} ${cachedText}`;
      el.errorBanner.classList.add('hidden');

      renderCategoryChips();
      renderEntries();

      if (forceRefresh) {
        showToast('Release notes successfully refreshed!');
      }
    } catch (err) {
      console.error('Error fetching release notes:', err);
      el.errorMessage.textContent = err.message || 'Unable to contact server or Google Cloud feed.';
      el.errorBanner.classList.remove('hidden');
      el.statusText.textContent = 'Feed unavailable';
      const dot = el.feedStatus.querySelector('.status-dot');
      if (dot) dot.classList.add('error');
    } finally {
      setLoadingState(false, forceRefresh);
    }
  }

  function setLoadingState(loading, isManualRefresh) {
    state.isLoading = loading;
    if (loading) {
      if (isManualRefresh) {
        el.refreshBtn.disabled = true;
        el.refreshSpinner.classList.remove('hidden');
        el.refreshIcon.classList.add('hidden');
        el.refreshBtnLabel.textContent = 'Refreshing...';
      } else {
        el.initialLoader.classList.remove('hidden');
      }
    } else {
      el.refreshBtn.disabled = false;
      el.refreshSpinner.classList.add('hidden');
      el.refreshIcon.classList.remove('hidden');
      el.refreshBtnLabel.textContent = 'Refresh Feed';
      el.initialLoader.classList.add('hidden');
    }
  }

  // --- Category Chips ---
  function renderCategoryChips() {
    // Count category occurrences
    const counts = { ALL: 0 };
    for (const entry of state.entries) {
      for (const item of entry.items) {
        counts.ALL = (counts.ALL || 0) + 1;
        counts[item.category] = (counts[item.category] || 0) + 1;
      }
    }

    let chipsHtml = `
      <button class="chip ${state.selectedCategory === 'ALL' ? 'active' : ''}" data-category="ALL">
        All (${counts.ALL || 0})
      </button>
    `;

    for (const cat of state.categories) {
      const count = counts[cat] || 0;
      chipsHtml += `
        <button class="chip ${state.selectedCategory === cat ? 'active' : ''}" data-category="${escapeHtml(cat)}">
          ${escapeHtml(cat)} (${count})
        </button>
      `;
    }

    el.categoryChips.innerHTML = chipsHtml;

    // Attach listeners
    el.categoryChips.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedCategory = btn.dataset.category;
        renderCategoryChips();
        renderEntries();
      });
    });
  }

  // --- Filtering Logic ---
  function getFilteredEntries() {
    const query = state.searchQuery.trim().toLowerCase();
    const cat = state.selectedCategory;

    const filtered = [];
    let matchCount = 0;

    for (const entry of state.entries) {
      const matchingItems = entry.items.filter(item => {
        // Category check
        if (cat !== 'ALL' && item.category !== cat) {
          return false;
        }
        // Search query check
        if (query) {
          const inCategory = item.category.toLowerCase().includes(query);
          const inText = item.text.toLowerCase().includes(query);
          const inDate = item.date.toLowerCase().includes(query);
          if (!inCategory && !inText && !inDate) {
            return false;
          }
        }
        return true;
      });

      if (matchingItems.length > 0) {
        filtered.push({
          ...entry,
          items: matchingItems
        });
        matchCount += matchingItems.length;
      }
    }

    return { filtered, matchCount };
  }

  // --- Render Entries ---
  function renderEntries() {
    const { filtered, matchCount } = getFilteredEntries();

    // Update Stats Summary
    if (state.searchQuery || state.selectedCategory !== 'ALL') {
      el.statsSummary.textContent = `Showing ${matchCount} update${matchCount === 1 ? '' : 's'}`;
    } else {
      el.statsSummary.textContent = `${state.feedData?.total_updates || 0} updates across ${state.entries.length} dates`;
    }

    if (filtered.length === 0) {
      el.emptyState.classList.remove('hidden');
      el.entriesList.innerHTML = '';
      return;
    }

    el.emptyState.classList.add('hidden');

    let html = '';
    for (const entry of filtered) {
      html += `
        <div class="date-group">
          <div class="date-header">
            <div class="date-title-group">
              <svg class="date-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <h2 class="date-title">${escapeHtml(entry.date)}</h2>
            </div>
            ${entry.link ? `
              <a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener noreferrer" class="date-link" title="Open in Google Cloud Release Notes">
                <span>Docs</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            ` : ''}
          </div>

          <div class="updates-grid">
      `;

      for (const item of entry.items) {
        const isSelected = state.selectedItem && state.selectedItem.id === item.id;
        const catClass = getCategoryClass(item.category);

        html += `
          <article class="update-card ${isSelected ? 'selected' : ''}" data-item-id="${escapeHtml(item.id)}">
            <div class="card-header">
              <div class="card-tags">
                <span class="category-tag ${catClass}">${escapeHtml(item.category)}</span>
                ${isSelected ? '<span class="selected-indicator">✓ Selected</span>' : ''}
              </div>

              <div class="card-actions">
                <button class="select-btn" data-action="select" aria-label="Select update to Tweet">
                  <span>${isSelected ? 'Selected' : 'Select'}</span>
                </button>
                <button class="tweet-btn-quick" data-action="tweet-direct" title="Tweet this update">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                  </svg>
                  <span>Tweet</span>
                </button>
              </div>
            </div>

            <div class="card-content">
              ${item.html}
            </div>
          </article>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    el.entriesList.innerHTML = html;
    attachCardListeners();
  }

  function findItemById(itemId) {
    for (const entry of state.entries) {
      for (const item of entry.items) {
        if (item.id === itemId) return item;
      }
    }
    return null;
  }

  function attachCardListeners() {
    el.entriesList.querySelectorAll('.update-card').forEach(card => {
      const itemId = card.dataset.itemId;
      const item = findItemById(itemId);
      if (!item) return;

      // Click card actions
      card.addEventListener('click', (e) => {
        // If clicking a link inside the card content, let it open normally
        if (e.target.closest('a')) return;

        const selectBtn = e.target.closest('[data-action="select"]');
        const tweetBtn = e.target.closest('[data-action="tweet-direct"]');

        if (tweetBtn) {
          e.stopPropagation();
          selectItem(item);
          openTweetModal();
          return;
        }

        if (selectBtn) {
          e.stopPropagation();
          if (state.selectedItem && state.selectedItem.id === item.id) {
            deselectItem();
          } else {
            selectItem(item);
          }
          return;
        }

        // Clicking anywhere else on the card selects it
        selectItem(item);
      });
    });
  }

  // --- Selection Management ---
  function selectItem(item) {
    state.selectedItem = item;
    updateSelectionBar();
    renderEntries(); // update highlighted card state
  }

  function deselectItem() {
    state.selectedItem = null;
    updateSelectionBar();
    renderEntries();
  }

  function updateSelectionBar() {
    if (state.selectedItem) {
      el.selectionSummary.textContent = `${state.selectedItem.category} update (${state.selectedItem.date})`;
      el.selectionBar.classList.remove('hidden');
    } else {
      el.selectionBar.classList.add('hidden');
    }
  }

  // --- Tweet Drafting & Composer ---
  function generateTweetDraft(item) {
    if (!item) return '';

    const category = item.category;
    const date = item.date;
    const docLink = item.link || 'https://cloud.google.com/bigquery';

    // Build active tags string
    const tagsStr = Array.from(state.activeHashtags).join(' ');

    // Calculate available space for the description snippet
    // Structure:
    // 🚀 BigQuery Update [Feature] (Sep 16, 2026):
    // <snippet>
    // 
    // 🔗 <docLink>
    // #BigQuery #GoogleCloud
    const header = `🚀 BigQuery [${category}] (${date}):\n`;
    const footer = `\n\n🔗 ${docLink}\n${tagsStr}`;

    // Target total max length ~ 275 chars
    const availableTextLength = Math.max(30, 275 - (header.length + footer.length));

    let snippet = item.text.replace(/\s+/g, ' ').trim();
    if (snippet.length > availableTextLength) {
      snippet = snippet.substring(0, availableTextLength - 3) + '...';
    }

    return `${header}${snippet}${footer}`;
  }

  function openTweetModal() {
    const item = state.selectedItem;
    if (!item) return;

    el.modalItemCategory.textContent = item.category;
    el.modalItemCategory.className = `category-tag ${getCategoryClass(item.category)}`;
    el.modalItemDate.textContent = item.date;
    el.modalItemSourceText.textContent = item.text;

    const draft = generateTweetDraft(item);
    el.tweetTextarea.value = draft;
    updateCharCount();

    el.tweetModal.classList.remove('hidden');
    el.tweetTextarea.focus();
  }

  function closeTweetModal() {
    el.tweetModal.classList.add('hidden');
  }

  function updateCharCount() {
    const text = el.tweetTextarea.value;
    const remaining = MAX_TWEET_LENGTH - text.length;

    el.charCount.textContent = remaining;

    // Ring progress calculation
    const progress = Math.max(0, Math.min(1, text.length / MAX_TWEET_LENGTH));
    const offset = CIRCLE_CIRCUMFERENCE * (1 - progress);
    el.charRingProgress.style.strokeDashoffset = offset;

    // Color indicators
    if (remaining < 0) {
      el.charCount.className = 'char-count danger';
      el.charRingProgress.style.stroke = '#d93025';
      el.modalTweetBtn.disabled = true;
    } else if (remaining <= 20) {
      el.charCount.className = 'char-count warning';
      el.charRingProgress.style.stroke = '#e37400';
      el.modalTweetBtn.disabled = false;
    } else {
      el.charCount.className = 'char-count';
      el.charRingProgress.style.stroke = '#1d9bf0';
      el.modalTweetBtn.disabled = false;
    }
  }

  function postToTwitter() {
    const text = el.tweetTextarea.value.trim();
    if (!text) {
      showToast('Tweet cannot be empty!');
      return;
    }

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    const popupWidth = 600;
    const popupHeight = 460;
    const left = Math.max(0, (window.screen.width - popupWidth) / 2);
    const top = Math.max(0, (window.screen.height - popupHeight) / 2);

    window.open(
      intentUrl,
      'twitter-intent',
      `width=${popupWidth},height=${popupHeight},top=${top},left=${left},toolbar=0,menubar=0,location=0,status=0,scrollbars=yes,resizable=yes`
    );

    showToast('Opening Twitter / X composer...');
  }

  async function copyTweetText() {
    const text = el.tweetTextarea.value;
    if (!text) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        el.tweetTextarea.select();
        document.execCommand('copy');
      }
      showToast('Tweet text copied to clipboard! 📋');
    } catch (err) {
      showToast('Could not copy to clipboard.');
    }
  }

  function handleTagClick(chip) {
    const tag = chip.dataset.tag;
    let currentText = el.tweetTextarea.value;

    if (state.activeHashtags.has(tag)) {
      state.activeHashtags.delete(tag);
      chip.classList.remove('active');
      // Remove tag from textarea if present
      const regex = new RegExp(`\\s*${tag}\\b`, 'g');
      currentText = currentText.replace(regex, '');
    } else {
      state.activeHashtags.add(tag);
      chip.classList.add('active');
      // Append tag if not present
      if (!currentText.includes(tag)) {
        currentText = currentText.trimEnd() + ` ${tag}`;
      }
    }

    el.tweetTextarea.value = currentText;
    updateCharCount();
  }

  // --- Event Listeners ---
  function initListeners() {
    // Refresh button
    el.refreshBtn.addEventListener('click', () => {
      fetchReleaseNotes(true);
    });

    // Error retry button
    el.errorRetryBtn.addEventListener('click', () => {
      fetchReleaseNotes(true);
    });

    // Search input
    el.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      if (state.searchQuery) {
        el.clearSearchBtn.classList.remove('hidden');
      } else {
        el.clearSearchBtn.classList.add('hidden');
      }
      renderEntries();
    });

    // Clear search button
    el.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      el.searchInput.value = '';
      el.clearSearchBtn.classList.add('hidden');
      renderEntries();
      el.searchInput.focus();
    });

    // Reset filters button in empty state
    el.resetFiltersBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.selectedCategory = 'ALL';
      el.searchInput.value = '';
      el.clearSearchBtn.classList.add('hidden');
      renderCategoryChips();
      renderEntries();
    });

    // Floating selection bar buttons
    el.barTweetBtn.addEventListener('click', openTweetModal);
    el.barClearBtn.addEventListener('click', deselectItem);

    // Modal controls
    el.modalCloseBtn.addEventListener('click', closeTweetModal);
    el.tweetModal.addEventListener('click', (e) => {
      if (e.target === el.tweetModal) closeTweetModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.tweetModal.classList.contains('hidden')) {
        closeTweetModal();
      }
    });

    el.tweetTextarea.addEventListener('input', updateCharCount);
    el.modalTweetBtn.addEventListener('click', postToTwitter);
    el.modalCopyBtn.addEventListener('click', copyTweetText);

    // Hashtags chips in modal
    el.quickTags.querySelectorAll('.tag-chip').forEach(chip => {
      chip.addEventListener('click', () => handleTagClick(chip));
    });
  }

  // --- Theme Management ---
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (el.themeToggle) {
      el.themeToggle.checked = (theme === 'dark');
    }
  }

  function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      applyTheme(savedTheme);
    } else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }

    if (el.themeToggle) {
      el.themeToggle.addEventListener('change', (e) => {
        const newTheme = e.target.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        showToast(newTheme === 'dark' ? 'Dunkelmodus aktiviert 🌙' : 'Hellmodus aktiviert ☀️', 2000);
      });
    }
  }

  // --- Initialization ---
  function init() {
    initTheme();
    initListeners();
    fetchReleaseNotes(false);
  }

  // Kick off when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
