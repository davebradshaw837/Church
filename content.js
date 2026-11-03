// Reads and writes the this-week.txt format. Shared by the public page and the admin page.
window.WillowfieldContent = (function () {
  'use strict';

  // Forgiving by design: unknown lines are ignored.
  function parse(text) {
    const data = { sunday: {}, welcome: {}, settings: {}, services: [], notices: [], events: [], steps: [], links: [] };
    let block = null;
    let inNotes = false;

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('//')) continue;

      const heading = line.match(/^#\s+(.+)$/);
      if (heading) {
        inNotes = false;
        const name = heading[1].trim().toUpperCase();
        if (name === 'SUNDAY') block = data.sunday;
        else if (name === 'WELCOME') block = data.welcome;
        else if (name === 'SETTINGS') block = data.settings;
        else if (name === 'SERVICE') data.services.push(block = { readings: [], notes: [] });
        else if (name === 'NOTICE') data.notices.push(block = {});
        else if (name === 'EVENT') data.events.push(block = {});
        else if (name === 'NEXT STEP') data.steps.push(block = {});
        else if (name === 'LINK') data.links.push(block = {});
        else block = null;
        continue;
      }
      if (!block) continue;
      if (inNotes) { block.notes.push(line); continue; }

      const pair = line.match(/^([^:]+):\s*(.*)$/);
      if (!pair) continue;
      const key = pair[1].trim().toLowerCase();
      const value = pair[2].trim();
      if (key === 'notes' && block.notes) inNotes = true;
      else if (key === 'reading' && block.readings) { if (value) block.readings.push(value); }
      else block[key] = value;
    }
    data.services.forEach((service) => { service.notes = trimBlankLines(service.notes); });
    return data;
  }

  function trimBlankLines(lines) {
    const result = lines.slice();
    while (result.length && !result[0].trim()) result.shift();
    while (result.length && !result[result.length - 1].trim()) result.pop();
    return result;
  }

  // 17/11/26 -> Date, or null if the event's date is written in words.
  function parseDate(text) {
    const m = (text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }

  const HEADER = [
    '// ============================================================',
    '// WILLOWFIELD SUNDAY PAGE: normally edited at /admin.',
    '// This file is rewritten on every publish, so any comments you add will be lost.',
    '//',
    '// To edit by hand: a line starting with # starts a new block. Change the text after',
    '// each colon, and keep "Notes:" as the last thing in a service block.',
    '// In Notes: ## a heading, - a bullet point, **bold words**.',
    '// ============================================================',
  ];

  const FIELD_ORDER = {
    sunday: ['date'],
    service: ['time', 'title', 'theme', 'led by', 'preaching', 'sample'],
    notice: ['title', 'about', 'link'],
    event: ['date', 'time', 'title', 'about', 'link'],
    link: ['title', 'link'],
    welcome: ['photo', 'photo description', 'meets', 'title', 'about', 'button', 'link'],
    step: ['title', 'about', 'link'],
    settings: ['events link'],
  };

  function label(key) {
    if (key === 'notes pdf') return 'Notes PDF';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function oneLine(value) {
    return String(value == null ? '' : value).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  }

  // Known fields in a fixed order, then anything else the file contained. Empty fields are left out.
  function writeFields(item, type) {
    const skip = new Set(['readings', 'notes', 'notes pdf']);
    const order = FIELD_ORDER[type];
    const keys = order.concat(Object.keys(item).filter((key) => !order.includes(key) && !skip.has(key)));
    return keys.filter((key) => oneLine(item[key])).map((key) => label(key) + ': ' + oneLine(item[key]));
  }

  function writeBlock(name, item, type) {
    return ['# ' + name].concat(writeFields(item, type));
  }

  // A line that the parser would treat as a new block or a comment is adjusted so its text survives.
  function safeNoteLine(line) {
    const trimmed = line.trim();
    if (/^#\s/.test(trimmed)) return '#' + trimmed;
    return trimmed.replace(/^\/\/+\s*/, '');
  }

  function writeService(service) {
    const lines = writeBlock('SERVICE', service, 'service');
    (service.readings || []).map(oneLine).filter(Boolean).forEach((reading) => lines.push('Reading: ' + reading));
    if (oneLine(service['notes pdf'])) lines.push('Notes PDF: ' + oneLine(service['notes pdf']));
    lines.push('Notes:');
    return lines.concat(trimBlankLines((service.notes || []).map(safeNoteLine)));
  }

  function serialize(data) {
    const blocks = [HEADER, writeBlock('SUNDAY', data.sunday, 'sunday')];
    data.services.forEach((item) => blocks.push(writeService(item)));
    data.notices.forEach((item) => blocks.push(writeBlock('NOTICE', item, 'notice')));
    data.events.forEach((item) => blocks.push(writeBlock('EVENT', item, 'event')));
    data.links.forEach((item) => blocks.push(writeBlock('LINK', item, 'link')));
    blocks.push(writeBlock('WELCOME', data.welcome, 'welcome'));
    data.steps.forEach((item) => blocks.push(writeBlock('NEXT STEP', item, 'step')));
    blocks.push(writeBlock('SETTINGS', data.settings, 'settings'));
    return blocks.map((block) => block.join('\n')).join('\n\n') + '\n';
  }

  return { parse, parseDate, serialize };
})();
