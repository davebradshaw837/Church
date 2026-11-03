(function () {
  'use strict';

  const { parse, parseDate, serialize } = window.WillowfieldContent;
  const DRAFT_KEY = 'willowfield:admin-draft';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const $ = (id) => document.getElementById(id);

  let state = null;       // the content being edited
  let published = '';     // the same content as last loaded, for spotting changes
  let sha = '';           // the version on GitHub these edits are based on
  let previewOnly = false;
  let busy = false;
  let draftTimer = null;
  const openItems = new WeakSet();

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'onclick' || key === 'oninput' || key === 'onchange') node[key] = value;
      else if (value !== false && value != null) node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  // Browser storage can be unavailable (private windows); editing still works without drafts.
  const draftStore = {
    get() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } },
    set(value) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(value)); } catch (e) { /* ignore */ } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } },
  };

  /* ---------- Messages ---------- */

  function showMessage(title, body, options = {}) {
    const box = el('div', { class: 'notice-box' + (options.good ? ' good' : '') }, el('strong', null, title));
    if (typeof body === 'string') box.append(el('p', null, body));
    else if (body) box.append(body);
    if (options.buttons) {
      box.append(el('div', { class: 'notice-actions' }, ...options.buttons.map((button) =>
        el('button', { type: 'button', class: button.primary ? 'btn-primary' : 'btn-small', onclick: button.action }, button.label))));
    }
    $('message').replaceChildren(box);
    box.scrollIntoView({ block: 'center' });
  }

  function clearMessage() {
    $('message').replaceChildren();
  }

  /* ---------- Talking to /api/content ---------- */

  class ApiError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  async function api(method, body, path = 'content') {
    let response;
    try {
      response = await fetch('../api/' + path, {
        method,
        cache: 'no-store',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError('network');
    }
    if (response.status === 404 && isLocal) throw new ApiError('local');
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new ApiError('error');
    }
    if (!response.ok) throw new ApiError(data.error || 'error');
    return data;
  }

  function explainError(error) {
    switch (error.code) {
      case 'not_signed_in': return ['Please sign in again', 'Your login has expired. Reload this page to sign in. Your changes are saved on this device.'];
      case 'network': return ['No connection', 'Check your connection and try again. Your changes are saved on this device.'];
      case 'not_set_up': return ['The admin page isn\'t set up yet', 'The site\'s login or GitHub settings are missing. See the setup guide in README.md.'];
      default: return ['Something went wrong', 'Nothing was published. Please try again, and contact whoever looks after the site if it keeps happening.'];
    }
  }

  /* ---------- Dates ---------- */

  function isoFromDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateFromIso(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  // "Sunday 8 November 2026" <-> a Date
  function sundayToIso(text) {
    const m = (text || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (!m) return '';
    const month = MONTHS.findIndex((name) => name.toLowerCase() === m[2].toLowerCase());
    return month < 0 ? '' : isoFromDate(new Date(Number(m[3]), month, Number(m[1])));
  }

  function longDate(date) {
    return DAYS[date.getDay()] + ' ' + date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function eventDateText(date) {
    return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getFullYear()).slice(2);
  }

  /* ---------- Form pieces ---------- */

  function field(labelText, control, hint) {
    return el('label', { class: 'field' },
      el('span', { class: 'field-label' }, labelText),
      hint ? el('span', { class: 'field-hint' }, hint) : null,
      control);
  }

  function textField(labelText, item, key, options = {}) {
    const props = {
      oninput: (event) => {
        item[key] = event.target.value;
        if (options.onInput) options.onInput();
        changed();
      },
    };
    if (options.placeholder) props.placeholder = options.placeholder;
    if (options.inputmode) props.inputmode = options.inputmode;
    const control = options.rows
      ? el('textarea', { ...props, rows: options.rows })
      : el('input', { ...props, type: 'text' });
    control.value = item[key] || '';
    return field(labelText, control, options.hint);
  }

  function linesField(labelText, item, key, options) {
    const control = el('textarea', {
      rows: options.rows,
      placeholder: options.placeholder,
      oninput: (event) => {
        item[key] = options.clean ? event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) : event.target.value.split('\n');
        changed();
      },
    });
    control.value = (item[key] || []).join('\n');
    return field(labelText, control, options.hint);
  }

  function linkField(labelText, item, key, onInput) {
    return textField(labelText, item, key, { inputmode: 'url', placeholder: 'https://', onInput });
  }

  // A list of cards that can be added to, reordered and removed.
  function listEditor(options) {
    const { items, blank, addLabel, title, tag, body } = options;
    const container = el('div');

    function draw() {
      const cards = items.map((item, index) => {
        const titleNode = el('span', null, title(item));
        const tagNode = el('span', { class: 'item-tag' }, tag ? tag(item) : '');
        const refresh = () => {
          titleNode.textContent = title(item);
          tagNode.textContent = tag ? tag(item) : '';
        };
        const card = el('details', { class: 'item' },
          el('summary', null, el('span', { class: 'item-title' }, titleNode, tagNode)),
          el('div', { class: 'item-body' },
            ...body(item, refresh),
            el('div', { class: 'item-tools' },
              el('button', { type: 'button', class: 'btn-tool', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(index, -1) }, '↑'),
              el('button', { type: 'button', class: 'btn-tool', 'aria-label': 'Move down', disabled: index === items.length - 1, onclick: () => move(index, 1) }, '↓'),
              el('button', { type: 'button', class: 'btn-tool remove', onclick: () => remove(index) }, 'Remove'))));
        card.open = openItems.has(item);
        card.addEventListener('toggle', () => {
          if (card.open) openItems.add(item);
          else openItems.delete(item);
        });
        return card;
      });
      container.replaceChildren(...cards, el('button', {
        type: 'button',
        class: 'btn-add',
        onclick: () => {
          const item = blank();
          openItems.add(item);
          items.push(item);
          draw();
          changed();
          const added = container.querySelectorAll('.item');
          const input = added[added.length - 1].querySelector('input, textarea, select');
          if (input) input.focus();
        },
      }, addLabel));
    }

    function move(index, direction) {
      const [item] = items.splice(index, 1);
      items.splice(index + direction, 0, item);
      draw();
      changed();
    }

    function remove(index) {
      if (!window.confirm('Remove "' + title(items[index]) + '"?')) return;
      items.splice(index, 1);
      draw();
      changed();
    }

    draw();
    return container;
  }

  function group(titleText, open, intro, ...children) {
    return el('details', { class: 'group', open: open ? '' : null },
      el('summary', null, titleText),
      el('div', { class: 'group-body' }, intro ? el('p', { class: 'group-intro' }, intro) : null, ...children));
  }

  /* ---------- The form ---------- */

  function sundayField() {
    const control = el('input', {
      type: 'date',
      onchange: (event) => {
        const date = dateFromIso(event.target.value);
        state.sunday.date = date ? longDate(date) : '';
        changed();
      },
    });
    control.value = sundayToIso(state.sunday.date);
    return field('Date', control);
  }

  function serviceBody(service, refresh) {
    const sample = el('input', {
      type: 'checkbox',
      onchange: (event) => {
        if (event.target.checked) service.sample = 'yes';
        else delete service.sample;
        changed();
      },
    });
    sample.checked = !!service.sample;
    return [
      textField('Time', service, 'time', { placeholder: 'e.g. 10am & 11.30am', hint: 'Keep am or pm in the time, so the page can open the right service on a Sunday.', onInput: refresh }),
      textField('Title', service, 'title', { onInput: refresh }),
      textField('Theme', service, 'theme'),
      textField('Led by', service, 'led by'),
      textField('Preaching', service, 'preaching'),
      linesField('Readings', service, 'readings', { rows: 3, clean: true, placeholder: 'Matthew 8:23-27', hint: 'One per line. Each links to that passage in the ESV.' }),
      linesField('Sermon notes', service, 'notes', { rows: 10, hint: 'Start a line with ## for a heading or - for a bullet point. Put **stars** around words to make them bold.' }),
      linkField('Notes PDF link (optional)', service, 'notes pdf'),
      el('label', { class: 'check' }, sample, 'Show a "Sample content" label'),
    ];
  }

  function eventWhen(event) {
    const date = parseDate(event.date);
    const day = date ? date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : event.date;
    return [day, event.time].filter(Boolean).join(', ');
  }

  function eventTag(event) {
    const date = parseDate(event.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date && date < today) return eventWhen(event) + ' (past, hidden from the page)';
    return eventWhen(event);
  }

  function eventBody(event, refresh) {
    const dated = el('input', {
      type: 'date',
      onchange: (e) => {
        const date = dateFromIso(e.target.value);
        event.date = date ? eventDateText(date) : '';
        refresh();
        changed();
      },
    });
    const existing = parseDate(event.date);
    if (existing) dated.value = isoFromDate(existing);
    const words = el('input', {
      type: 'text',
      placeholder: 'e.g. Every Wednesday',
      oninput: (e) => {
        event.date = e.target.value;
        refresh();
        changed();
      },
    });
    const isRegular = !!event.date && !existing;
    if (isRegular) words.value = event.date;
    const datedField = field('Date', dated, 'Hides itself from the page after this date.');
    const wordsField = field('When', words, 'Stays on the page until you remove it.');
    const kind = el('select', {
      onchange: (e) => {
        const regular = e.target.value === 'regular';
        datedField.hidden = regular;
        wordsField.hidden = !regular;
        event.date = regular ? words.value : (dateFromIso(dated.value) ? eventDateText(dateFromIso(dated.value)) : '');
        refresh();
        changed();
      },
    }, el('option', { value: 'date' }, 'On a specific date'), el('option', { value: 'regular' }, 'Regular event'));
    kind.value = isRegular ? 'regular' : 'date';
    datedField.hidden = isRegular;
    wordsField.hidden = !isRegular;
    return [
      textField('Title', event, 'title', { onInput: refresh }),
      field('Type', kind),
      datedField,
      wordsField,
      textField('Time', event, 'time', { placeholder: 'e.g. 7.30pm', onInput: refresh }),
      textField('Description', event, 'about', { rows: 3 }),
      linkField('Link (optional)', event, 'link'),
    ];
  }

  function titleBody(linkLabel) {
    return (item, refresh) => [
      textField('Title', item, 'title', { onInput: refresh }),
      textField('Description', item, 'about', { rows: 2 }),
      linkField(linkLabel, item, 'link'),
    ];
  }

  function renderForm() {
    const untitled = (text, fallback) => (text || '').trim() || fallback;
    $('form').replaceChildren(
      group('This Sunday', true, null,
        sundayField(),
        el('p', { class: 'field-label', style: 'margin:16px 0 6px' }, 'Services'),
        listEditor({
          items: state.services,
          blank: () => ({ readings: [], notes: [] }),
          addLabel: 'Add a service',
          title: (service) => untitled(service.time, 'New service'),
          tag: (service) => service.title || '',
          body: serviceBody,
        })),
      group('Notices', false, 'If there are none, this section disappears from the page.',
        listEditor({
          items: state.notices,
          blank: () => ({}),
          addLabel: 'Add a notice',
          title: (item) => untitled(item.title, 'New notice'),
          body: titleBody('Link (optional)'),
        })),
      group("What's On", false, null,
        listEditor({
          items: state.events,
          blank: () => ({}),
          addLabel: 'Add an event',
          title: (item) => untitled(item.title, 'New event'),
          tag: eventTag,
          body: eventBody,
        }),
        textField('"See everything" link', state.settings, 'events link', { inputmode: 'url' })),
      group('Next Steps', false, null,
        listEditor({
          items: state.steps,
          blank: () => ({}),
          addLabel: 'Add a next step',
          title: (item) => untitled(item.title, 'New next step'),
          body: titleBody('Link'),
        })),
      group('Quick Links', false, null,
        listEditor({
          items: state.links,
          blank: () => ({}),
          addLabel: 'Add a link',
          title: (item) => untitled(item.title, 'New link'),
          tag: (item) => item.link || '',
          body: (item, refresh) => [
            textField('Title', item, 'title', { onInput: refresh }),
            linkField('Link', item, 'link', refresh),
          ],
        })),
      group('Welcome', false, 'You should rarely need to change these.',
        linkField('Photo link', state.welcome, 'photo'),
        textField('Photo description', state.welcome, 'photo description', { hint: 'Read aloud by screen readers.' }),
        textField('Service times and location', state.welcome, 'meets', { rows: 3 }),
        textField('"New here?" heading', state.welcome, 'title'),
        textField('"New here?" text', state.welcome, 'about', { rows: 4 }),
        textField('Button text', state.welcome, 'button'),
        linkField('Button link', state.welcome, 'link')));
  }

  /* ---------- Checks before publishing ---------- */

  function validate() {
    const problems = [];
    const named = (text, fallback) => ((text || '').trim() ? '"' + text.trim() + '"' : fallback);
    const validLink = (url) => /^(https?:\/\/\S+|mailto:\S+|tel:\S+)$/i.test((url || '').trim());
    const checkLink = (url, where) => {
      if ((url || '').trim() && !validLink(url)) problems.push(where + ': the link should start with https://');
    };

    if (!sundayToIso(state.sunday.date)) problems.push('This Sunday: choose a date');
    if (!state.services.length) problems.push('This Sunday: add at least one service');
    state.services.forEach((service, i) => {
      const name = 'Service ' + named(service.time, i + 1);
      if (!(service.time || '').trim()) problems.push(name + ': add a time');
      checkLink(service['notes pdf'], name);
    });
    state.notices.forEach((item, i) => {
      const name = 'Notice ' + named(item.title, i + 1);
      if (!(item.title || '').trim()) problems.push(name + ': add a title');
      checkLink(item.link, name);
    });
    state.events.forEach((item, i) => {
      const name = 'Event ' + named(item.title, i + 1);
      if (!(item.title || '').trim()) problems.push(name + ': add a title');
      if (!(item.date || '').trim()) problems.push(name + ': add a date');
      checkLink(item.link, name);
    });
    state.steps.forEach((item, i) => {
      const name = 'Next step ' + named(item.title, i + 1);
      if (!(item.title || '').trim()) problems.push(name + ': add a title');
      if (!validLink(item.link)) problems.push(name + ': add a link starting with https://');
    });
    state.links.forEach((item, i) => {
      const name = 'Quick link ' + named(item.title, i + 1);
      if (!(item.title || '').trim()) problems.push(name + ': add a title');
      if (!validLink(item.link)) problems.push(name + ': add a link starting with https://, mailto: or tel:');
    });
    checkLink(state.settings['events link'], 'What\'s On');
    checkLink(state.welcome.photo, 'Welcome photo');
    checkLink(state.welcome.link, 'Welcome button');
    return problems;
  }

  /* ---------- Changes and drafts ---------- */

  function currentText() {
    return serialize(state);
  }

  function isDirty() {
    return !!state && currentText() !== published;
  }

  function updateStatus(text) {
    const dirty = isDirty();
    $('status').textContent = text || (dirty ? 'Unpublished changes' : 'No changes');
    $('publish').disabled = busy || !dirty;
    $('discard').hidden = !dirty;
  }

  function changed() {
    updateStatus();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function saveDraft() {
    if (isDirty()) draftStore.set({ baseSha: sha, text: currentText() });
    else draftStore.clear();
  }

  function loadInto(text, baseSha) {
    state = parse(text);
    published = serialize(parse(text));
    sha = baseSha;
    renderForm();
    updateStatus();
  }

  function offerDraft() {
    const draft = draftStore.get();
    if (!draft || typeof draft.text !== 'string' || draft.text === published) {
      draftStore.clear();
      return;
    }
    const newer = draft.baseSha !== sha;
    showMessage('You have unpublished changes', newer
      ? 'They were saved on this device, but the page has been published since then. Restoring them may replace someone else\'s changes.'
      : 'They were saved on this device the last time you edited.', {
      buttons: [
        {
          label: 'Restore my changes',
          primary: true,
          action: () => {
            state = parse(draft.text);
            sha = draft.baseSha;
            renderForm();
            updateStatus();
            clearMessage();
          },
        },
        {
          label: 'Discard them',
          action: () => {
            draftStore.clear();
            clearMessage();
          },
        },
      ],
    });
  }

  /* ---------- Publishing ---------- */

  async function publish() {
    const problems = validate();
    if (problems.length) {
      showMessage('Please fix these before publishing', el('ul', null, ...problems.map((problem) => el('li', null, problem))));
      return;
    }
    clearMessage();
    const text = currentText();

    if (previewOnly) {
      $('local-text').value = text;
      $('local-output').hidden = false;
      showMessage('Nothing was published', 'This is a preview on your computer. The text below is what would be saved.');
      return;
    }

    setBusy(true);
    try {
      const saved = await api('PUT', { text, sha });
      sha = saved.sha;
      published = text;
      draftStore.clear();
      showMessage('Published', 'The page will update in about a minute.', { good: true });
    } catch (error) {
      saveDraft();
      if (error.code === 'conflict') showConflict();
      else showMessage(...explainError(error));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value) {
    busy = value;
    updateStatus(value ? 'Publishing…' : '');
  }

  function showConflict() {
    showMessage('Someone else has just published', 'Load their version to start again from it, which loses your changes here. Or publish yours anyway, which replaces theirs. Past versions are kept in GitHub if anything needs recovering.', {
      buttons: [
        { label: 'Load their version', primary: true, action: loadLatest },
        { label: 'Publish mine anyway', action: publishAnyway },
      ],
    });
  }

  async function loadLatest() {
    try {
      const latest = await api('GET');
      draftStore.clear();
      loadInto(latest.text, latest.sha);
      showMessage('Latest version loaded', 'You\'re now editing what\'s published.', { good: true });
    } catch (error) {
      showMessage(...explainError(error));
    }
  }

  async function publishAnyway() {
    if (!window.confirm('Replace the other person\'s changes with yours?')) return;
    try {
      const latest = await api('GET');
      sha = latest.sha;
      await publish();
    } catch (error) {
      showMessage(...explainError(error));
    }
  }

  /* ---------- Preview ---------- */

  function openPreview() {
    window.willowfieldPreviewText = currentText();
    $('preview-frame').src = '../?preview=1&t=' + Date.now();
    $('preview-layer').hidden = false;
    $('preview-close').focus();
  }

  function closePreview() {
    $('preview-layer').hidden = true;
    $('preview-frame').removeAttribute('src');
    $('preview').focus();
  }

  /* ---------- Signing in and out ---------- */

  function showLogin() {
    $('loading').hidden = true;
    $('login').hidden = false;
    $('username').focus();
  }

  async function signIn(event) {
    event.preventDefault();
    const error = $('login-error');
    error.hidden = true;
    $('login-button').disabled = true;
    try {
      await api('POST', { username: $('username').value, password: $('password').value }, 'login');
      $('password').value = '';
      $('login').hidden = true;
      $('loading').hidden = false;
      await loadContent();
    } catch (failure) {
      error.textContent = {
        wrong_login: 'That username or password isn\'t right.',
        too_many_attempts: 'Too many wrong attempts. Please wait 15 minutes and try again.',
        network: 'No connection. Check your connection and try again.',
        not_set_up: 'The login isn\'t set up yet. See the setup guide in README.md.',
      }[failure.code] || 'Something went wrong. Please try again.';
      error.hidden = false;
      $('password').value = '';
      $('password').focus();
    } finally {
      $('login-button').disabled = false;
    }
  }

  async function signOut() {
    if (isDirty() && !window.confirm('Sign out and discard your unpublished changes?')) return;
    clearTimeout(draftTimer);
    try {
      await api('POST', {}, 'logout');
      draftStore.clear();
      location.reload();
    } catch (error) {
      showMessage('Couldn\'t sign out', 'Check your connection and try again.');
    }
  }

  /* ---------- Start ---------- */

  async function loadContent() {
    let text;
    let version;
    try {
      const loaded = await api('GET');
      text = loaded.text;
      version = loaded.sha;
      $('sign-out').hidden = false;
    } catch (error) {
      if (error.code === 'not_signed_in') {
        showLogin();
        return;
      }
      if (error.code !== 'local') {
        $('loading').hidden = true;
        showMessage(...explainError(error), { buttons: [{ label: 'Reload', primary: true, action: () => location.reload() }] });
        return;
      }
      // Only on a computer previewing the site, where there's nothing to publish to.
      previewOnly = true;
      $('local-banner').hidden = false;
      text = await (await fetch('../this-week.txt', { cache: 'no-store' })).text();
      version = 'local';
    }

    loadInto(text, version);
    $('loading').hidden = true;
    $('form').hidden = false;
    $('actions').hidden = false;
    offerDraft();
  }

  async function start() {
    $('login').addEventListener('submit', signIn);
    $('sign-out').onclick = signOut;
    $('publish').onclick = publish;
    $('preview').onclick = openPreview;
    $('preview-close').onclick = closePreview;
    $('discard').onclick = () => {
      if (!window.confirm('Discard your unpublished changes?')) return;
      draftStore.clear();
      loadInto(published, sha);
      clearMessage();
    };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('preview-layer').hidden) closePreview();
    });
    $('form').addEventListener('submit', (event) => event.preventDefault());
    await loadContent();
  }

  start();
})();
