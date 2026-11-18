'use strict';

const I18n = {
  locale: 'zh-CN',
  staticText: [],
  staticAttributes: [],
  pick(zh, en) { return this.locale === 'en' ? en : zh; },
  text(source) { return this.locale === 'en' && Object.hasOwn(ENGLISH, source) ? ENGLISH[source] : source; },
  fixed(source) { return this.locale === 'en' ? this.lines?.get(source) || this.text(source) : source; },
  registerLines(groups) {
    this.lines = new Map();
    for (const [key, lines] of Object.entries(groups)) {
      const translations = ENGLISH_LINES[key]?.split('|');
      if (translations?.length === lines.length) lines.forEach((line, i) => this.lines.set(line, translations[i]));
    }
  },
  init() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const key = node.data.trim();
      if (!Object.hasOwn(ENGLISH, key) || node.parentElement.closest('script, style')) continue;
      const option = node.parentElement.closest('option:not([value])');
      if (option) option.value = option.value;
      this.staticText.push([node, key]);
    }
    for (const node of document.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) {
      for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
        const key = node.getAttribute(attr);
        if (Object.hasOwn(ENGLISH, key)) this.staticAttributes.push([node, attr, key]);
      }
    }
    this.title = document.title;
    this.apply(new URLSearchParams(location.search).get('lang'));
  },
  apply(locale) {
    this.locale = locale === 'en' ? 'en' : 'zh-CN';
    document.documentElement.lang = this.locale;
    document.title = this.text(this.title);
    for (const [node, key] of this.staticText) {
      node.data = node.data.replace(node.data.trim(), this.text(key));
    }
    for (const [node, attr, key] of this.staticAttributes) node.setAttribute(attr, this.text(key));
    for (const node of document.querySelectorAll('[data-message-key]')) node.textContent = this.text(node.dataset.messageKey);
    const button = document.querySelector('#languageToggle');
    if (button) {
      button.textContent = this.pick('English', '中文');
      button.lang = this.pick('en', 'zh-CN');
    }
  },
  label(node, key) {
    node.dataset.messageKey = key;
    node.textContent = this.text(key);
  },
};

I18n.init();
