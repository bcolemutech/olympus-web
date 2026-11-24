(function () {
  'use strict';

  // The Muse's Markdown renderer (planning/the-muse.md §4, "Text in
  // Markdown"; M-101 / #889), used for every text in the app. It is safe by
  // construction: the source is HTML-escaped first, and only the tags written
  // here are made, so no markup or script in a text reaches the page. Links
  // keep http(s), mailto and the Muse's own `muse:el/<id>` (an element) and
  // `muse:cl/<id>` (a class, M-201); anything else is shown as plain text.
  //
  //   Muse.markdown.render(text, options) → an HTML string
  //   Muse.markdown.into(node, text, options) → fills a node, marked for styling
  //
  // Auto-links (EL6, M-103): when the app has given it a matcher
  // (Muse.markdown.useMatcher), a name or alias found in the text outside
  // code and links is shown as a link to its element. `options.except` is an
  // element id not to link (the element whose own text it is).

  var Muse = (window.Muse = window.Muse || {});

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escape(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }
  function unescape(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  var ELEMENT_LINK = /^muse:(el|cl)\/([A-Za-z0-9_-]{1,128})$/;
  var SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

  // A link's tag, or null when its target isn't one we allow.
  function link(label, rawUrl) {
    var url = unescape(rawUrl);
    var el = ELEMENT_LINK.exec(url);
    if (el) {
      return (
        '<a class="muse-el-link" href="#" data-' +
        el[1] +
        '="' +
        escape(el[2]) +
        '">' +
        label +
        '</a>'
      );
    }
    if (SAFE_URL.test(url)) {
      return (
        '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
      );
    }
    return null;
  }

  // The matcher that finds names to link (./links.js buildMatcher), from
  // `matcherOf()`, or none.
  var matcherOf = null;

  // Names in `text`, which may hold held placeholders: only what lies between
  // them is looked at, so code and links are left as they are.
  function autolink(text, hold, except) {
    var matcher = matcherOf && matcherOf();
    if (!matcher || !matcher.size) return text;
    return text
      .split(/(\u0000\d+\u0000)/)
      .map(function (part, i) {
        return i % 2 ? part : matcher.link(part, hold, except);
      })
      .join('');
  }

  // Inline marks on one escaped line: code, links, names, bold, italic, struck.
  function inline(escaped, except) {
    var held = [];
    var hold = function (html) {
      held.push(html);
      return '\u0000' + (held.length - 1) + '\u0000';
    };
    var out = escaped
      .replace(/`([^`]+)`/g, function (_, code) {
        return hold('<code>' + code + '</code>');
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (whole, label, url) {
        var tag = link(label, url);
        return tag ? hold(tag) : whole;
      });
    out = autolink(out, hold, except)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__([^_\s][^_]*?)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // Links may hold marks of their own, so they are put back twice.
    for (var pass = 0; pass < 2; pass++) {
      out = out.replace(/\u0000(\d+)\u0000/g, function (_, n) {
        return held[Number(n)];
      });
    }
    return out;
  }

  function render(text, options) {
    var except = options && options.except;
    var lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    var html = [];
    var para = [];
    var list = null; // { tag, items }
    var quote = [];

    function flushPara() {
      if (para.length) {
        html.push(
          '<p>' +
            para
              .map(function (line) {
                return inline(line, except);
              })
              .join('<br>') +
            '</p>'
        );
      }
      para = [];
    }
    function flushList() {
      if (list) {
        html.push(
          '<' +
            list.tag +
            '>' +
            list.items
              .map(function (item) {
                return '<li>' + inline(item, except) + '</li>';
              })
              .join('') +
            '</' +
            list.tag +
            '>'
        );
      }
      list = null;
    }
    function flushQuote() {
      if (quote.length)
        html.push('<blockquote>' + render(quote.join('\n'), options) + '</blockquote>');
      quote = [];
    }
    function flush() {
      flushPara();
      flushList();
      flushQuote();
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var m;

      // A fenced code block, kept as it is.
      if (/^\s*```/.test(raw)) {
        flush();
        var code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        html.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>');
        continue;
      }

      if ((m = /^\s*>\s?(.*)$/.exec(raw))) {
        flushPara();
        flushList();
        quote.push(m[1]);
        continue;
      }
      flushQuote();

      var line = escape(raw);
      if (!raw.trim()) {
        flush();
      } else if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        flush();
        html.push('<h' + m[1].length + '>' + inline(m[2], except) + '</h' + m[1].length + '>');
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) {
        flush();
        html.push('<hr>');
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushPara();
        if (!list || list.tag !== 'ul') {
          flushList();
          list = { tag: 'ul', items: [] };
        }
        list.items.push(m[1]);
      } else if ((m = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        if (!list || list.tag !== 'ol') {
          flushList();
          list = { tag: 'ol', items: [] };
        }
        list.items.push(m[1]);
      } else if (list && /^\s{2,}\S/.test(raw)) {
        // A wrapped list item.
        list.items[list.items.length - 1] += ' ' + line.trim();
      } else {
        flushList();
        para.push(line);
      }
    }
    flush();
    return html.join('\n');
  }

  function into(node, text, options) {
    node.classList.add('muse-md');
    node.innerHTML = render(text, options);
    return node;
  }

  Muse.markdown = {
    render: render,
    into: into,
    escape: escape,
    useMatcher: function (fn) {
      matcherOf = fn;
    },
  };
})();
