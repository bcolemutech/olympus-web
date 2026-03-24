(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var NODE_RADIUS = 8;
  var NODE_RADIUS_CURRENT = 12;
  var LABEL_OFFSET = 16;
  var MAP_PADDING = 40;
  var ZOOM_STEP = 0.25;
  var MIN_ZOOM = 0.4;
  var MAX_ZOOM = 3;

  /** Color palette per system type. */
  var TYPE_COLORS = {
    station: '#4dd0e1',
    planet: '#81c784',
    anomaly: '#ce93d8',
    derelict: '#ff8a65',
  };
  var DEFAULT_NODE_COLOR = '#90a4ae';

  var _mapState = { zoom: 1, offsetX: 0, offsetY: 0 };
  var _activeTooltip = null;
  var _globalMouseMove = null;
  var _globalMouseUp = null;
  var _previewLine = null;
  var _previewLabel = null;

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  /**
   * Create a type-aware SVG shape for a star system node.
   * Returns an SVG element (circle, rect, polygon, or group).
   */
  function _createNodeShape(type, x, y, r, extraClass) {
    var color = TYPE_COLORS[type] || DEFAULT_NODE_COLOR;
    var el;

    switch (type) {
      case 'station':
        // Rounded rectangle
        el = document.createElementNS(SVG_NS, 'rect');
        el.setAttribute('x', x - r * 0.8);
        el.setAttribute('y', y - r * 0.8);
        el.setAttribute('width', r * 1.6);
        el.setAttribute('height', r * 1.6);
        el.setAttribute('rx', r * 0.25);
        el.setAttribute('fill', color);
        break;
      case 'anomaly':
        // Diamond (rotated square)
        var d = r * 1.1;
        el = document.createElementNS(SVG_NS, 'polygon');
        el.setAttribute(
          'points',
          x +
            ',' +
            (y - d) +
            ' ' +
            (x + d) +
            ',' +
            y +
            ' ' +
            x +
            ',' +
            (y + d) +
            ' ' +
            (x - d) +
            ',' +
            y
        );
        el.setAttribute('fill', color);
        break;
      case 'derelict':
        // Circle with an X through it — classes on children for CSS overrides
        el = document.createElementNS(SVG_NS, 'g');
        var dc = document.createElementNS(SVG_NS, 'circle');
        dc.setAttribute('cx', x);
        dc.setAttribute('cy', y);
        dc.setAttribute('r', r);
        dc.setAttribute('class', 'star-derelict-circle');
        dc.setAttribute('opacity', '0.5');
        el.appendChild(dc);
        var cross1 = document.createElementNS(SVG_NS, 'line');
        cross1.setAttribute('x1', x - r * 0.55);
        cross1.setAttribute('y1', y - r * 0.55);
        cross1.setAttribute('x2', x + r * 0.55);
        cross1.setAttribute('y2', y + r * 0.55);
        cross1.setAttribute('class', 'star-derelict-cross');
        cross1.setAttribute('stroke-width', '1.5');
        el.appendChild(cross1);
        var cross2 = document.createElementNS(SVG_NS, 'line');
        cross2.setAttribute('x1', x + r * 0.55);
        cross2.setAttribute('y1', y - r * 0.55);
        cross2.setAttribute('x2', x - r * 0.55);
        cross2.setAttribute('y2', y + r * 0.55);
        cross2.setAttribute('class', 'star-derelict-cross');
        cross2.setAttribute('stroke-width', '1.5');
        el.appendChild(cross2);
        break;
      default:
        // Planet / unknown — circle
        el = document.createElementNS(SVG_NS, 'circle');
        el.setAttribute('cx', x);
        el.setAttribute('cy', y);
        el.setAttribute('r', r);
        el.setAttribute('fill', type === 'planet' ? color : DEFAULT_NODE_COLOR);
        break;
    }

    if (extraClass && el.setAttribute) {
      el.setAttribute('class', extraClass);
    }
    return el;
  }

  /**
   * Add SVG <defs> with fog filter and ship icon.
   */
  function _addSvgDefs(svg) {
    var defs = document.createElementNS(SVG_NS, 'defs');

    // Fog of war filter — blur + fade
    var fogFilter = document.createElementNS(SVG_NS, 'filter');
    fogFilter.setAttribute('id', 'fog-filter');
    fogFilter.setAttribute('x', '-50%');
    fogFilter.setAttribute('y', '-50%');
    fogFilter.setAttribute('width', '200%');
    fogFilter.setAttribute('height', '200%');
    var blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('stdDeviation', '2');
    fogFilter.appendChild(blur);
    defs.appendChild(fogFilter);

    // Ship icon symbol
    var ship = document.createElementNS(SVG_NS, 'symbol');
    ship.setAttribute('id', 'ship-icon');
    ship.setAttribute('viewBox', '0 0 24 24');
    var shipPath = document.createElementNS(SVG_NS, 'path');
    shipPath.setAttribute('d', 'M12 2 L4 20 L12 16 L20 20 Z');
    shipPath.setAttribute('fill', '#ffd54f');
    shipPath.setAttribute('stroke', '#0a0e1a');
    shipPath.setAttribute('stroke-width', '1');
    ship.appendChild(shipPath);
    defs.appendChild(ship);

    svg.appendChild(defs);
  }

  /**
   * Render the Map tab — star map visualization.
   */
  VO.renderMapTab = function (container) {
    var game = VO.state.currentGame;
    if (!game) {
      container.innerHTML = '<p class="sidebar-placeholder">No game loaded.</p>';
      return;
    }

    container.innerHTML = '<p class="sidebar-placeholder">Loading star map&hellip;</p>';

    VO.loadStarMap(game.id)
      .then(function (systems) {
        _renderMap(container, systems, game);
      })
      .catch(function (err) {
        console.error('Failed to load star map:', err);
        container.innerHTML =
          '<p class="sidebar-placeholder">Unable to load star map. You may be offline or lack permission.</p>';
      });
  };

  function _renderMap(container, systems, game) {
    var currentSystemId = (game.ship && game.ship.currentSystemId) || '';

    // Build a lookup for all systems
    var sysById = {};
    systems.forEach(function (s) {
      sysById[s.id] = s;
    });

    // Discovered systems are fully visible; undiscovered systems adjacent
    // to a discovered system are shown fogged (fog of war)
    var discoveredIds = {};
    systems.forEach(function (s) {
      if (s.discovered) discoveredIds[s.id] = true;
    });

    var foggedIds = {};
    systems.forEach(function (s) {
      if (!s.discovered) return;
      (s.connections || []).forEach(function (conn) {
        var target = sysById[conn.targetId];
        if (target && !target.discovered && !foggedIds[conn.targetId]) {
          foggedIds[conn.targetId] = true;
        }
      });
    });

    // Visible = discovered + fogged
    var visible = systems.filter(function (s) {
      return discoveredIds[s.id] || foggedIds[s.id];
    });

    if (visible.length === 0) {
      container.innerHTML = '<p class="sidebar-empty">No star systems charted yet.</p>';
      return;
    }

    // Calculate bounding box
    var minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    visible.forEach(function (s) {
      var x = (s.coordinates && s.coordinates.x) || 0;
      var y = (s.coordinates && s.coordinates.y) || 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });

    // Ensure minimum viewport size
    var rangeX = Math.max(maxX - minX, 60);
    var rangeY = Math.max(maxY - minY, 60);
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;

    var viewWidth = rangeX + MAP_PADDING * 2;
    var viewHeight = rangeY + MAP_PADDING * 2;
    var vbX = cx - viewWidth / 2;
    var vbY = cy - viewHeight / 2;

    // Build wrapper
    var html = '<div class="star-map-container" id="star-map-wrap">';

    // Controls
    html +=
      '<div class="star-map-controls">' +
      '<button type="button" class="star-map-zoom-btn" id="star-map-zoom-in" title="Zoom in">+</button>' +
      '<button type="button" class="star-map-zoom-btn" id="star-map-zoom-out" title="Zoom out">&minus;</button>' +
      '<button type="button" class="star-map-zoom-btn" id="star-map-zoom-reset" title="Reset view">&#8634;</button>' +
      '</div>';

    // Fuel indicator
    var fuel = (game.ship && game.ship.fuel) || 0;
    html += '<div class="star-map-fuel">Fuel: ' + fuel + '%</div>';

    html += '</div>';

    container.innerHTML = html;

    // Create SVG programmatically
    var wrap = document.getElementById('star-map-wrap');
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'star-map-svg');
    svg.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + viewWidth + ' ' + viewHeight);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    wrap.insertBefore(svg, wrap.firstChild.nextSibling); // after controls

    // Add SVG defs (fog filter, ship icon)
    _addSvgDefs(svg);

    // Draw connections first (behind nodes)
    visible.forEach(function (sys) {
      var x1 = (sys.coordinates && sys.coordinates.x) || 0;
      var y1 = (sys.coordinates && sys.coordinates.y) || 0;
      var connections = sys.connections || [];

      connections.forEach(function (conn) {
        var target = sysById[conn.targetId];
        if (!target || (!discoveredIds[conn.targetId] && !foggedIds[conn.targetId])) return;

        // Only draw each connection once (from lower id to higher)
        if (sys.id > conn.targetId) return;

        var x2 = (target.coordinates && target.coordinates.x) || 0;
        var y2 = (target.coordinates && target.coordinates.y) || 0;

        var line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);

        var hasHazards = conn.hazards && conn.hazards.length > 0;
        var isKnown = conn.known;

        if (hasHazards) {
          line.setAttribute('class', 'star-connection star-connection-hazardous');
        } else if (!isKnown) {
          line.setAttribute('class', 'star-connection star-connection-unknown');
        } else {
          line.setAttribute('class', 'star-connection');
        }

        svg.appendChild(line);

        // Fuel cost label at midpoint
        if (conn.distance) {
          var mx = (x1 + x2) / 2;
          var my = (y1 + y2) / 2;
          var costLabel = document.createElementNS(SVG_NS, 'text');
          costLabel.setAttribute('x', mx);
          costLabel.setAttribute('y', my - 3);
          costLabel.setAttribute('class', 'star-map-cost-label');
          costLabel.textContent = conn.distance;
          svg.appendChild(costLabel);
        }
      });
    });

    // Draw system nodes
    visible.forEach(function (sys) {
      var x = (sys.coordinates && sys.coordinates.x) || 0;
      var y = (sys.coordinates && sys.coordinates.y) || 0;
      var isCurrent = sys.id === currentSystemId;
      var isVisited = sys.visited;
      var isFogged = !!foggedIds[sys.id];
      // Map backend types to visual categories.
      // Backend uses: system, anomaly, hidden. Infer station from hasServices.
      var rawType = (sys.type || '').toLowerCase();
      var sysType =
        rawType === 'anomaly'
          ? 'anomaly'
          : rawType === 'derelict'
            ? 'derelict'
            : sys.hasServices
              ? 'station'
              : rawType === 'system' || rawType === ''
                ? 'planet'
                : rawType;

      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'star-node-group');
      g.setAttribute('data-system-id', sys.id);

      if (isFogged) {
        // Fogged nodes: simple circle with fog filter
        var fogCircle = document.createElementNS(SVG_NS, 'circle');
        fogCircle.setAttribute('cx', x);
        fogCircle.setAttribute('cy', y);
        fogCircle.setAttribute('r', NODE_RADIUS - 2);
        fogCircle.setAttribute('class', 'star-node star-node-fogged');
        fogCircle.setAttribute('filter', 'url(#fog-filter)');
        g.appendChild(fogCircle);
      } else {
        // Discovered nodes: type-aware shape
        var r = isCurrent ? NODE_RADIUS_CURRENT : NODE_RADIUS;
        var stateClass = isCurrent
          ? 'star-node star-node-current'
          : isVisited
            ? 'star-node star-node-visited'
            : 'star-node star-node-discovered';
        var typeClass = sysType && TYPE_COLORS[sysType] ? ' star-node-' + sysType : '';

        var shape = _createNodeShape(sysType, x, y, r, stateClass + typeClass);
        g.appendChild(shape);
      }

      // Pulse ring for current system
      if (isCurrent) {
        var pulse = document.createElementNS(SVG_NS, 'circle');
        pulse.setAttribute('cx', x);
        pulse.setAttribute('cy', y);
        pulse.setAttribute('r', NODE_RADIUS_CURRENT);
        pulse.setAttribute('class', 'star-node-pulse');
        g.appendChild(pulse);

        // Ship icon
        var shipUse = document.createElementNS(SVG_NS, 'use');
        shipUse.setAttribute('href', '#ship-icon');
        shipUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#ship-icon');
        shipUse.setAttribute('x', x - 6);
        shipUse.setAttribute('y', y - 6);
        shipUse.setAttribute('width', 12);
        shipUse.setAttribute('height', 12);
        shipUse.setAttribute('class', 'star-ship-icon');
        g.appendChild(shipUse);
      }

      // Label
      if (!isFogged) {
        var label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y + LABEL_OFFSET);
        label.setAttribute(
          'class',
          'star-map-label' + (isCurrent ? ' star-map-label-current' : '')
        );
        label.textContent = sys.name || '???';
        g.appendChild(label);
        g.style.cursor = 'pointer';

        // Click handler for tooltip
        g.addEventListener('click', function (e) {
          e.stopPropagation();
          _showSystemTooltip(wrap, sys, currentSystemId, sysById, game);
        });

        // Route preview on hover (only for systems connected to current)
        (function (hoveredSys) {
          g.addEventListener('mouseenter', function () {
            _showRoutePreview(svg, hoveredSys, currentSystemId, sysById, game);
          });
          g.addEventListener('mouseleave', function () {
            _clearRoutePreview();
          });
        })(sys);
      } else {
        var fogLabel = document.createElementNS(SVG_NS, 'text');
        fogLabel.setAttribute('x', x);
        fogLabel.setAttribute('y', y + LABEL_OFFSET);
        fogLabel.setAttribute('class', 'star-map-label star-map-label-fogged');
        fogLabel.textContent = '???';
        g.appendChild(fogLabel);
      }

      svg.appendChild(g);
    });

    // Click on SVG background dismisses tooltip
    svg.addEventListener('click', function () {
      _dismissTooltip();
    });

    // Zoom controls
    _mapState.zoom = 1;
    _mapState.offsetX = 0;
    _mapState.offsetY = 0;

    function _updateViewBox() {
      var z = _mapState.zoom;
      var w = viewWidth / z;
      var h = viewHeight / z;
      var ox = cx - w / 2 + _mapState.offsetX;
      var oy = cy - h / 2 + _mapState.offsetY;
      svg.setAttribute('viewBox', ox + ' ' + oy + ' ' + w + ' ' + h);
    }

    var zoomInBtn = document.getElementById('star-map-zoom-in');
    var zoomOutBtn = document.getElementById('star-map-zoom-out');
    var zoomResetBtn = document.getElementById('star-map-zoom-reset');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _mapState.zoom = Math.min(MAX_ZOOM, _mapState.zoom + ZOOM_STEP);
        _updateViewBox();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _mapState.zoom = Math.max(MIN_ZOOM, _mapState.zoom - ZOOM_STEP);
        _updateViewBox();
      });
    }
    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _mapState.zoom = 1;
        _mapState.offsetX = 0;
        _mapState.offsetY = 0;
        _updateViewBox();
      });
    }

    // Pan via drag — remove previous global listeners to avoid accumulation
    if (_globalMouseMove) window.removeEventListener('mousemove', _globalMouseMove);
    if (_globalMouseUp) window.removeEventListener('mouseup', _globalMouseUp);

    var _dragging = false;
    var _dragStart = { x: 0, y: 0 };

    svg.addEventListener('mousedown', function (e) {
      if (e.target.closest('.star-node-group')) return;
      _dragging = true;
      _dragStart.x = e.clientX;
      _dragStart.y = e.clientY;
      svg.style.cursor = 'grabbing';
    });

    _globalMouseMove = function (e) {
      if (!_dragging) return;
      var dx = e.clientX - _dragStart.x;
      var dy = e.clientY - _dragStart.y;
      var svgRect = svg.getBoundingClientRect();
      var scaleX = viewWidth / _mapState.zoom / svgRect.width;
      var scaleY = viewHeight / _mapState.zoom / svgRect.height;
      _mapState.offsetX -= dx * scaleX;
      _mapState.offsetY -= dy * scaleY;
      _dragStart.x = e.clientX;
      _dragStart.y = e.clientY;
      _updateViewBox();
    };

    _globalMouseUp = function () {
      if (_dragging) {
        _dragging = false;
        svg.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', _globalMouseMove);
    window.addEventListener('mouseup', _globalMouseUp);

    // Touch pan support
    svg.addEventListener(
      'touchstart',
      function (e) {
        if (e.touches.length === 1 && !e.target.closest('.star-node-group')) {
          _dragging = true;
          _dragStart.x = e.touches[0].clientX;
          _dragStart.y = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    svg.addEventListener(
      'touchmove',
      function (e) {
        if (!_dragging || e.touches.length !== 1) return;
        var dx = e.touches[0].clientX - _dragStart.x;
        var dy = e.touches[0].clientY - _dragStart.y;
        var svgRect = svg.getBoundingClientRect();
        var scaleX = viewWidth / _mapState.zoom / svgRect.width;
        var scaleY = viewHeight / _mapState.zoom / svgRect.height;
        _mapState.offsetX -= dx * scaleX;
        _mapState.offsetY -= dy * scaleY;
        _dragStart.x = e.touches[0].clientX;
        _dragStart.y = e.touches[0].clientY;
        _updateViewBox();
      },
      { passive: true }
    );

    svg.addEventListener(
      'touchend',
      function () {
        _dragging = false;
      },
      { passive: true }
    );
  }

  /**
   * Show a route preview line from current system to hovered system.
   */
  function _showRoutePreview(svg, hoveredSys, currentSystemId, sysById, game) {
    _clearRoutePreview();
    if (hoveredSys.id === currentSystemId) return;

    var currentSys = sysById[currentSystemId];
    if (!currentSys || !currentSys.connections) return;

    var conn = currentSys.connections.find(function (c) {
      return c.targetId === hoveredSys.id;
    });
    if (!conn) return;

    var x1 = (currentSys.coordinates && currentSys.coordinates.x) || 0;
    var y1 = (currentSys.coordinates && currentSys.coordinates.y) || 0;
    var x2 = (hoveredSys.coordinates && hoveredSys.coordinates.x) || 0;
    var y2 = (hoveredSys.coordinates && hoveredSys.coordinates.y) || 0;

    // Highlight line
    var line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'star-connection-preview');
    svg.appendChild(line);
    _previewLine = line;

    // If distance is unknown, skip fuel cost label to avoid misleading values
    if (conn.distance == null) {
      return;
    }

    // Fuel cost label at midpoint
    var fuelCost = conn.distance;
    var fuel = (game.ship && game.ship.fuel) || 0;
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;
    var costText = document.createElementNS(SVG_NS, 'text');
    costText.setAttribute('x', mx);
    costText.setAttribute('y', my - 6);
    costText.setAttribute(
      'class',
      'star-map-preview-cost' + (fuel < fuelCost ? ' star-map-preview-cost-warn' : '')
    );
    costText.textContent = 'Fuel: ' + fuelCost;
    svg.appendChild(costText);
    _previewLabel = costText;
  }

  /**
   * Remove route preview elements from the SVG.
   */
  function _clearRoutePreview() {
    if (_previewLine && _previewLine.parentNode) {
      _previewLine.parentNode.removeChild(_previewLine);
    }
    if (_previewLabel && _previewLabel.parentNode) {
      _previewLabel.parentNode.removeChild(_previewLabel);
    }
    _previewLine = null;
    _previewLabel = null;
  }

  function _showSystemTooltip(wrap, system, currentSystemId, sysById, game) {
    _dismissTooltip();

    var isCurrent = system.id === currentSystemId;
    var fuel = (game.ship && game.ship.fuel) || 0;

    // Find connection from current system to this one
    var currentSys = sysById[currentSystemId];
    var connection = null;
    if (currentSys && currentSys.connections) {
      connection =
        currentSys.connections.find(function (c) {
          return c.targetId === system.id;
        }) || null;
    }

    var html = '';
    html += '<div class="star-map-tooltip-header">' + _esc(system.name || '???') + '</div>';

    // Type and danger badges
    html += '<div style="margin-bottom:0.4rem">';
    if (system.type) {
      html += '<span class="sidebar-badge">' + _esc(system.type) + '</span> ';
    }
    var dangerColors = {
      safe: 'sidebar-badge-green',
      cautious: 'sidebar-badge-yellow',
      dangerous: 'sidebar-badge-orange',
      hostile: 'sidebar-badge-red',
    };
    var dangerCls = dangerColors[system.dangerLevel] || 'sidebar-badge';
    html +=
      '<span class="sidebar-badge ' +
      dangerCls +
      '">' +
      _esc(system.dangerLevel || 'unknown') +
      '</span>';
    html += '</div>';

    // Faction
    if (system.faction) {
      html += '<div class="star-map-tooltip-row">Faction: ' + _esc(system.faction) + '</div>';
    }

    // Services
    if (system.hasServices) {
      html += '<div class="star-map-tooltip-row">Services available</div>';
    }

    // Visited status
    html +=
      '<div class="star-map-tooltip-row">' + (system.visited ? 'Visited' : 'Unvisited') + '</div>';

    // Rumors
    if (system.rumors && system.rumors.length > 0) {
      html += '<div class="star-map-tooltip-rumors">';
      for (var r = 0; r < system.rumors.length; r++) {
        html +=
          '<div class="star-map-tooltip-rumor">&ldquo;' + _esc(system.rumors[r]) + '&rdquo;</div>';
      }
      html += '</div>';
    }

    // Travel button (only if connected and not current)
    if (!isCurrent && connection) {
      var fuelCost = connection.distance || 10;
      var hasEnoughFuel = fuel >= fuelCost;
      var hazardWarning =
        connection.hazards && connection.hazards.length > 0
          ? ' (Hazards: ' + connection.hazards.join(', ') + ')'
          : '';

      if (!hasEnoughFuel) {
        html +=
          '<div class="star-map-tooltip-warning">Insufficient fuel — need ' +
          fuelCost +
          ', have ' +
          fuel +
          '</div>';
      }

      html +=
        '<button type="button" class="star-map-travel-btn' +
        (hasEnoughFuel ? '' : ' star-map-travel-btn-warn') +
        '" id="star-map-travel-btn">' +
        'Travel here (fuel: ~' +
        fuelCost +
        ')' +
        '</button>';

      if (hazardWarning) {
        html += '<div class="star-map-tooltip-hazard">' + _esc(hazardWarning) + '</div>';
      }
    } else if (isCurrent) {
      html += '<div class="star-map-tooltip-row" style="color:#ffd54f">You are here</div>';
    }

    var tooltip = document.createElement('div');
    tooltip.className = 'star-map-tooltip';
    tooltip.innerHTML = html;
    wrap.appendChild(tooltip);
    _activeTooltip = tooltip;

    // Travel button handler
    var travelBtn = document.getElementById('star-map-travel-btn');
    if (travelBtn && connection) {
      var btnFuelCost = connection.distance || 10;
      if (fuel < btnFuelCost) {
        travelBtn.disabled = true;
      } else {
        travelBtn.addEventListener('click', function () {
          _dismissTooltip();
          VO.submitTurn({
            type: 'navigation',
            actionId: 'travel_to_' + system.id,
            input:
              'Set course for ' +
              (system.name || 'unknown system') +
              ' (distance: ' +
              (connection.distance || '?') +
              ', estimated fuel: ' +
              btnFuelCost +
              ')',
          });
        });
      }
    }
  }

  function _dismissTooltip() {
    if (_activeTooltip && _activeTooltip.parentNode) {
      _activeTooltip.parentNode.removeChild(_activeTooltip);
    }
    _activeTooltip = null;
  }
})();
