(function () {
  'use strict';

  // The player's token (planning/tokens.md §4.3, TK2; L-933 / #791): the
  // picker the new-game flow (creation.js) and the Character panel
  // (character.js) share.
  //
  // - The world's player portraits (loomCreationRules' `portraits`), each a
  //   round button, and Upload your own (a PNG, JPEG or WebP of at most
  //   5 MB); with none in the world, upload only.
  // - The one chosen in a circle as its token will show: drag it to centre
  //   the face (or the arrow keys), and a zoom slider.
  // - `send` stores the choice: a portrait as a token turn (no AP, no time),
  //   an upload through loomUploadToken, which squares it at the crop.
  //
  // A choice is `{ id, src, crop }` (a portrait), `{ file, src, crop }` (an
  // upload not yet sent) or `{ keep: true, src, crop }` (the token the
  // character has, its circle moved); null is none (initials).

  var Loom = window.Loom;
  var ui = Loom.ui;
  var html = ui.html;
  var hooks = ui.hooks;
  var state = Loom.state;

  var MAX_BYTES = 5 * 1024 * 1024; // as loomUploadToken
  var TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var MAX_ZOOM = 4; // the slider's top (the server takes up to 10)
  var CIRCLE = 168; // the crop's circle, in px
  var THUMB = 56;

  // Images' natural sizes, by URL, once each.
  var sizes = {};
  function useSize(src) {
    var s = hooks.useState(src && sizes[src] ? sizes[src] : null);
    var size = s[0];
    var setSize = s[1];
    hooks.useEffect(
      function () {
        if (!src) return undefined;
        if (sizes[src]) {
          setSize(sizes[src]);
          return undefined;
        }
        var live = true;
        var img = new window.Image();
        img.onload = function () {
          sizes[src] = { width: img.naturalWidth, height: img.naturalHeight };
          if (live) setSize(sizes[src]);
        };
        img.src = src;
        return function () {
          live = false;
        };
      },
      [src]
    );
    return size;
  }

  /** A crop with its defaults: centred and fitted. */
  function cropOf(crop) {
    crop = crop || {};
    return {
      x: typeof crop.x === 'number' ? crop.x : 0.5,
      y: typeof crop.y === 'number' ? crop.y : 0.5,
      zoom: typeof crop.zoom === 'number' && crop.zoom >= 1 ? crop.zoom : 1,
    };
  }

  /** The crop moved inside the image: the circle never runs off it. */
  function clampCrop(crop, size) {
    var c = cropOf(crop);
    if (!size) return c;
    var side = Math.min(size.width, size.height) / c.zoom;
    var hx = side / 2 / size.width;
    var hy = side / 2 / size.height;
    var clamp = function (v, half) {
      return Math.max(half, Math.min(1 - half, v));
    };
    return { x: clamp(c.x, hx), y: clamp(c.y, hy), zoom: c.zoom };
  }

  // Where the image sits in a circle `d` across: its scale and offset.
  function placing(size, crop, d) {
    var c = cropOf(crop);
    var k = d / (Math.min(size.width, size.height) / c.zoom);
    return {
      k: k,
      width: size.width * k,
      height: size.height * k,
      left: d / 2 - c.x * size.width * k,
      top: d / 2 - c.y * size.height * k,
    };
  }

  /** A picture in a circle `size` px across, at its crop. */
  function Circle(props) {
    var natural = useSize(props.src);
    var d = props.size;
    var at = natural && placing(natural, props.crop, d);
    return html`<span
      class=${'loom-token-circle' + (props.className ? ' ' + props.className : '')}
      style=${{ width: d + 'px', height: d + 'px' }}
    >
      ${at
        ? html`<img
            src=${props.src}
            alt=""
            draggable="false"
            style=${{
              width: at.width + 'px',
              height: at.height + 'px',
              left: at.left + 'px',
              top: at.top + 'px',
            }}
          />`
        : props.initials && html`<span class="loom-token-initials">${props.initials}</span>`}
    </span>`;
  }

  /** A token picture as loomGetMap sends it, drawn in a circle (an upload read as its owner). */
  function Token(props) {
    var s = hooks.useState(null);
    var src = s[0];
    var setSrc = s[1];
    var key = Loom.tokenKey(props.picture);
    hooks.useEffect(
      function () {
        if (!key) {
          setSrc(null);
          return undefined;
        }
        var live = true;
        Loom.tokenUrl(props.picture)
          .then(function (url) {
            if (live) setSrc(url);
          })
          .catch(function () {});
        return function () {
          live = false;
        };
      },
      [key]
    );
    return html`<${Circle}
      src=${src}
      crop=${props.picture && props.picture.crop}
      size=${props.size || THUMB}
      initials=${props.initials}
    />`;
  }

  // The circle to frame the choice in: drag, arrow keys, and the zoom.
  function Crop(props) {
    var value = props.value;
    var natural = useSize(value.src);
    var drag = hooks.useRef(null);
    var crop = clampCrop(value.crop, natural);

    function set(next) {
      props.onChange(Object.assign({}, value, { crop: clampCrop(next, natural) }));
    }

    function down(event) {
      if (!natural) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, crop: crop };
    }
    function move(event) {
      var d = drag.current;
      if (!d || !natural) return;
      var k = placing(natural, d.crop, CIRCLE).k;
      set({
        x: d.crop.x - (event.clientX - d.x) / (natural.width * k),
        y: d.crop.y - (event.clientY - d.y) / (natural.height * k),
        zoom: d.crop.zoom,
      });
    }
    function up() {
      drag.current = null;
    }
    function key(event) {
      var steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      var step = steps[event.key];
      if (!step || !natural) return;
      event.preventDefault();
      var by = 0.02 / crop.zoom;
      set({ x: crop.x + step[0] * by, y: crop.y + step[1] * by, zoom: crop.zoom });
    }

    return html`<div class="loom-token-crop" id=${props.id + '-crop'}>
      <div
        class="loom-token-frame"
        id=${props.id + '-frame'}
        tabindex="0"
        role="img"
        aria-label="Your token: drag to centre it, or use the arrow keys"
        onPointerDown=${down}
        onPointerMove=${move}
        onPointerUp=${up}
        onPointerCancel=${up}
        onKeyDown=${key}
      >
        <${Circle} src=${value.src} crop=${crop} size=${CIRCLE} />
      </div>
      <label class="loom-token-zoom">
        <span>Zoom</span>
        <input
          type="range"
          id=${props.id + '-zoom'}
          min="1"
          max=${String(MAX_ZOOM)}
          step="0.05"
          value=${String(crop.zoom)}
          onInput=${function (event) {
            set({ x: crop.x, y: crop.y, zoom: Number(event.currentTarget.value) });
          }}
        />
      </label>
      <p class="loom-create-dim">Drag the picture to centre the face.</p>
    </div>`;
  }

  /**
   * The picker: the world's portraits, Upload your own, and the crop.
   * Props: { id, portraits, value, onChange, current? } — `current` is the
   * token the character has (`{ link | file, crop }`), offered to re-crop.
   */
  function Picker(props) {
    var e = hooks.useState(null);
    var error = e[0];
    var setError = e[1];
    var value = props.value;
    var portraits = props.portraits || [];

    function pickFile(event) {
      var file = event.currentTarget.files && event.currentTarget.files[0];
      event.currentTarget.value = '';
      if (!file) return;
      if (TYPES.indexOf(file.type) === -1) {
        setError('That file isn’t a picture: use a PNG, JPEG or WebP.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('That picture is larger than 5 MB: try a smaller one.');
        return;
      }
      setError(null);
      props.onChange({ file: file, src: window.URL.createObjectURL(file), crop: cropOf(null) });
    }

    return html`<div class="loom-token-picker" id=${props.id}>
      <div class="loom-token-choices" role="group" aria-label="Portraits">
        ${portraits.map(function (p) {
          var on = Boolean(value && value.id === p.id);
          return html`<button
            key=${p.id}
            type="button"
            class=${'loom-token-choice' + (on ? ' is-on' : '')}
            data-portrait=${p.id}
            aria-pressed=${on ? 'true' : 'false'}
            aria-label="A portrait"
            onClick=${function () {
              setError(null);
              props.onChange({ id: p.id, src: p.link, crop: cropOf(p.crop) });
            }}
          >
            <${Circle} src=${p.link} crop=${p.crop} size=${THUMB} />
          </button>`;
        })}
        <label
          class=${'loom-token-choice loom-token-upload' + (value && value.file ? ' is-on' : '')}
        >
          <input
            type="file"
            id=${props.id + '-file'}
            accept=${TYPES.join(',')}
            onChange=${pickFile}
          />
          <span>${value && value.file ? 'Another picture' : 'Upload your own'}</span>
        </label>
      </div>
      ${portraits.length === 0 &&
      html`<p class="loom-create-dim">This world offers no portraits: upload your own.</p>`}
      ${error && html`<p class="loom-error" id=${props.id + '-error'}>${error}</p>`}
      ${value &&
      html`<${Crop}
        id=${props.id}
        value=${value}
        onChange=${function (next) {
          props.onChange(next);
        }}
      />`}
    </div>`;
  }

  // A File as base64, for loomUploadToken.
  function base64Of(file) {
    return new Promise(function (resolve, reject) {
      var reader = new window.FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(new Error('The picture could not be read.'));
      };
      reader.readAsDataURL(file);
    });
  }

  function cropToSend(crop) {
    var c = cropOf(crop);
    var round = function (n) {
      return Math.round(n * 10000) / 10000;
    };
    return { x: round(c.x), y: round(c.y), zoom: round(c.zoom) };
  }

  /**
   * Stores a choice for a save: an upload through loomUploadToken, else a
   * token turn (a portrait, the crop moved, or null for none). Resolves with
   * the server's answer; rejects with its message.
   */
  function send(worldId, saveId, value) {
    if (value && value.file) {
      return base64Of(value.file).then(function (image) {
        return state.functions
          .httpsCallable('loomUploadToken')({
            saveId: saveId,
            image: image,
            crop: cropToSend(value.crop),
          })
          .then(function (result) {
            return result.data;
          });
      });
    }
    var token = null;
    if (value && value.id) token = { image: value.id, crop: cropToSend(value.crop) };
    else if (value && value.keep) token = { crop: cropToSend(value.crop) };
    return state.functions
      .httpsCallable('loomPlayTurn')({
        worldId: worldId,
        saveId: saveId,
        action: { verb: 'token', token: token },
      })
      .then(function (result) {
        if (result.data && result.data.refused) throw new Error(result.data.narration);
        return result.data;
      });
  }

  /** What loomCreateSave takes for a choice: a portrait, or nothing (an upload goes after). */
  function forCreate(value) {
    return value && value.id ? { image: value.id, crop: cropToSend(value.crop) } : null;
  }

  Loom.tokenPicker = {
    Picker: Picker,
    Token: Token,
    send: send,
    forCreate: forCreate,
    clampCrop: clampCrop,
  };
})();
