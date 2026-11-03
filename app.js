(function () {
  'use strict';

  const CACHE_KEY = 'willowfield:last-content';
  const $ = (id) => document.getElementById(id);

  const { parse, parseDate } = window.WillowfieldContent;

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  function safeUrl(url) {
    return /^(https?:|mailto:|tel:)/i.test(url || '') ? url : null;
  }

  function linkProps(url, cls) {
    const props = { href: url, class: cls };
    if (/^https?:/i.test(url)) { props.target = '_blank'; props.rel = 'noopener'; }
    return props;
  }

  // **bold** becomes <strong>; everything else stays plain text, so nothing in the file can inject HTML.
  function inline(text) {
    const frag = document.createDocumentFragment();
    text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
      if (part) frag.append(i % 2 ? el('strong', null, part) : part);
    });
    return frag;
  }

  function renderNotes(lines, target) {
    target.replaceChildren();
    let list = null;
    for (const line of lines) {
      if (!line) { list = null; continue; }
      if (line.startsWith('##')) {
        list = null;
        target.append(el('h3', null, line.replace(/^#+\s*/, '')));
      } else if (/^[-•]\s+/.test(line)) {
        if (!list) target.append(list = el('ul'));
        list.append(el('li', null, inline(line.replace(/^[-•]\s+/, ''))));
      } else {
        list = null;
        target.append(el('p', null, inline(line)));
      }
    }
  }

  // "10am & 11.30am" -> [600, 690] (minutes after midnight)
  function startTimes(label) {
    return [...(label || '').matchAll(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)/gi)].map((m) => {
      const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      return hour * 60 + Number(m[2] || 0);
    });
  }

  // On a Sunday, open whichever service is on now or starting within 30 minutes.
  function defaultService(services, now) {
    if (now.getDay() !== 0) return 0;
    const minutes = now.getHours() * 60 + now.getMinutes();
    let chosen = 0;
    services.forEach((service, i) => {
      if (startTimes(service.time).some((start) => start <= minutes + 30)) chosen = i;
    });
    return chosen;
  }

  function row(item) {
    const text = el('span', { class: 'row-text' }, el('strong', null, item.title), item.about ? el('small', null, item.about) : null);
    const url = safeUrl(item.link);
    if (!url) return el('div', { class: 'row' }, text);
    return el('a', linkProps(url, 'row'), text, el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));
  }

  function eventCard(event, isNext) {
    const date = parseDate(event.date);
    const dateBlock = date
      ? el('span', { class: 'event-date' },
          el('span', { class: 'event-day' }, String(date.getDate())),
          el('span', { class: 'event-month' }, date.toLocaleDateString('en-GB', { month: 'short' })))
      : el('span', { class: 'event-date event-weekly' }, event.date || '');
    const when = date
      ? [date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), event.time].filter(Boolean).join(', ')
      : event.time;
    const text = el('span', { class: 'event-text' },
      el('strong', null, event.title),
      when ? el('span', { class: 'event-when' }, when) : null,
      event.about ? el('small', null, event.about) : null);
    const parts = isNext ? [el('span', { class: 'pill' }, 'Next up'), dateBlock, text] : [dateBlock, text];
    const cls = isNext ? 'event event-next' : date ? 'event' : 'event event-regular';
    const url = safeUrl(event.link);
    return url ? el('a', linkProps(url, cls), ...parts) : el('div', { class: cls }, ...parts);
  }

  function renderService(data, index) {
    const service = data.services[index];

    [...$('service-switch').children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
    });

    const info = $('service-info');
    info.replaceChildren();
    if (service.sample) info.append(el('span', { class: 'tag' }, 'Sample content'));
    info.append(el('p', { class: 'service-title' }, service.title || service.time));
    if (service.theme) info.append(el('p', { class: 'service-theme' }, service.theme));
    const people = el('dl', { class: 'people' });
    for (const [key, label] of [['led by', 'Led by'], ['preaching', 'Preaching']]) {
      if (service[key]) people.append(el('dt', null, label), el('dd', null, service[key]));
    }
    if (people.children.length) info.append(people);

    const readings = $('readings-list');
    readings.replaceChildren();
    if (service.readings.length) {
      readings.className = 'list';
      for (const reference of service.readings) {
        const url = 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(reference) + '&version=ESV';
        readings.append(el('a', linkProps(url, 'row'),
          el('span', { class: 'row-text' }, el('strong', null, reference), el('small', null, 'Open in ESV')),
          el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→')));
      }
    } else {
      readings.className = 'panel';
      readings.append(el('p', { class: 'empty' }, "This service's readings will appear here."));
    }

    const notes = $('notes-body');
    renderNotes(service.notes, notes);
    const pdf = safeUrl(service['notes pdf']);
    if (pdf) notes.append(el('a', linkProps(pdf, 'pdf'), 'Download the notes (PDF)'));
    if (!notes.children.length) notes.append(el('p', { class: 'empty' }, "This service's notes will appear here."));

    const box = $('my-notes');
    const key = 'willowfield:notes:' + data.sunday.date + ':' + service.time;
    box.value = store.get(key) || '';
    box.oninput = () => store.set(key, box.value);

    const copy = $('copy-notes');
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(notesText(data, service, box.value));
        copy.textContent = 'Copied';
      } catch (e) {
        // Clipboard unavailable: select the box so it can be copied by hand.
        box.select();
        copy.textContent = 'Select and copy';
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
    };

    const share = $('share-notes');
    share.hidden = !navigator.share;
    share.onclick = async () => {
      try {
        await navigator.share({ text: notesText(data, service, box.value) });
      } catch (e) { /* share sheet dismissed */ }
    };
  }

  // The sermon outline and the visitor's own notes, as plain text to keep.
  function notesText(data, service, mine) {
    const parts = ['Willowfield Church, ' + data.sunday.date + ', ' + service.time];
    if (service.title) parts[0] += '\n' + service.title;
    const outline = service.notes.join('\n').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
    if (outline) parts.push('SERMON NOTES\n' + outline);
    if (mine.trim()) parts.push('MY NOTES\n' + mine.trim());
    return parts.join('\n\n');
  }

  // Browser storage can be unavailable (private windows); the page still works without it.
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } },
  };

  function render(data) {
    $('sunday-date').textContent = data.sunday.date || '';
    $('meets').textContent = data.welcome.meets || '';

    const photo = safeUrl(data.welcome.photo);
    if (photo) {
      $('hero-photo').src = photo;
      $('hero-photo').alt = data.welcome['photo description'] || '';
      $('hero-photo').hidden = false;
    }

    $('notices-list').replaceChildren(...data.notices.map(row));
    $('notices').hidden = !data.notices.length;

    const switcher = $('service-switch');
    switcher.replaceChildren();
    data.services.forEach((service, i) => {
      const button = el('button', { type: 'button' }, service.time);
      button.addEventListener('click', () => renderService(data, i));
      switcher.append(button);
    });
    if (data.services.length) renderService(data, defaultService(data.services, new Date()));

    const welcome = $('welcome');
    welcome.replaceChildren();
    if (data.welcome.title) welcome.append(el('h3', null, data.welcome.title));
    if (data.welcome.about) welcome.append(el('p', null, data.welcome.about));
    const hello = safeUrl(data.welcome.link);
    if (hello) welcome.append(el('a', linkProps(hello, 'btn-solid'), data.welcome.button || 'Say hello'));

    $('steps').replaceChildren(...data.steps.map(row));

    // Soonest dated event first, then regular events written in words.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dated = data.events
      .filter((event) => parseDate(event.date) && parseDate(event.date) >= today)
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const regular = data.events.filter((event) => !parseDate(event.date));
    const events = $('events');
    events.replaceChildren(
      ...dated.map((event, i) => eventCard(event, i === 0)),
      ...regular.map((event) => eventCard(event, false)));
    if (!events.children.length) events.append(el('p', { class: 'empty' }, 'More events coming soon.'));

    const more = safeUrl(data.settings['events link']);
    if (more) {
      const link = $('events-link');
      link.href = more;
      link.target = '_blank';
      link.rel = 'noopener';
      link.hidden = false;
    }

    $('links').replaceChildren(...data.links.filter((l) => safeUrl(l.link)).map((l) =>
      el('a', linkProps(l.link), l.title)));

    $('content').hidden = false;
    $('error').hidden = true;
    trackSections();
  }

  // Underlines the current section in the sticky links as you scroll.
  function trackSections() {
    if (!('IntersectionObserver' in window)) return;
    const links = [...document.querySelectorAll('.jump a')];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.setAttribute('aria-current', String(a.hash === '#' + entry.target.id)));
      }
    }, { rootMargin: '-15% 0px -80% 0px' });
    links.forEach((a) => {
      const target = document.querySelector(a.hash);
      if (target) observer.observe(target);
    });
  }

  // The admin page shows unpublished changes by loading this page in a frame with ?preview=1.
  function previewText() {
    if (!/[?&]preview=1/.test(location.search) || window.parent === window) return null;
    try {
      return typeof window.parent.willowfieldPreviewText === 'string' ? window.parent.willowfieldPreviewText : null;
    } catch (e) {
      return null;
    }
  }

  async function start() {
    const draft = previewText();
    if (draft) {
      render(parse(draft));
      return;
    }
    try {
      // no-cache asks the server whether the file has changed, so edits appear on the next visit.
      const response = await fetch('this-week.txt', { cache: 'no-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      store.set(CACHE_KEY, text);
      render(parse(text));
    } catch (e) {
      // Patchy signal in the building: fall back to the last copy this phone saw.
      const cached = store.get(CACHE_KEY);
      if (cached) render(parse(cached));
      else $('error').hidden = false;
    }
  }

  start();
})();
