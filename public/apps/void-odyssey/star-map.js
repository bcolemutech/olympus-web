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

  var _mapState = { zoom: 1, offsetX: 0, offsetY: 0 };
  var _activeTooltip = null;

  /** Escape HTML. */
  function _esc(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
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

    // Filter to only discovered systems (fog of war)
    var visible = systems.filter(function (s) {
      return s.discovered;
    });

    if (visible.length === 0) {
      container.innerHTML = '<p class="sidebar-empty">No star systems charted yet.</p>';
      return;
    }

    // Build a lookup for all systems (including undiscovered, for connection drawing)
    var sysById = {};
    systems.forEach(function (s) {
      sysById[s.id] = s;
    });

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

    // Draw connections first (behind nodes)
    visible.forEach(function (sys) {
      var x1 = (sys.coordinates && sys.coordinates.x) || 0;
      var y1 = (sys.coordinates && sys.coordinates.y) || 0;
      var connections = sys.connections || [];

      connections.forEach(function (conn) {
        var target = sysById[conn.targetId];
        if (!target || !target.discovered) return;

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

      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'star-node-group');
      g.setAttribute('data-system-id', sys.id);
      g.style.cursor = 'pointer';

      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', isCurrent ? NODE_RADIUS_CURRENT : NODE_RADIUS);

      if (isCurrent) {
        circle.setAttribute('class', 'star-node star-node-current');
      } else if (isVisited) {
        circle.setAttribute('class', 'star-node star-node-visited');
      } else {
        circle.setAttribute('class', 'star-node star-node-discovered');
      }

      g.appendChild(circle);

      // Pulse ring for current system
      if (isCurrent) {
        var pulse = document.createElementNS(SVG_NS, 'circle');
        pulse.setAttribute('cx', x);
        pulse.setAttribute('cy', y);
        pulse.setAttribute('r', NODE_RADIUS_CURRENT);
        pulse.setAttribute('class', 'star-node-pulse');
        g.appendChild(pulse);
      }

      // Label
      var label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', y + LABEL_OFFSET);
      label.setAttribute('class', 'star-map-label' + (isCurrent ? ' star-map-label-current' : ''));
      label.textContent = sys.name || '???';
      g.appendChild(label);

      // Click handler for tooltip
      g.addEventListener('click', function (e) {
        e.stopPropagation();
        _showSystemTooltip(wrap, sys, currentSystemId, sysById, game);
      });

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

    // Pan via drag
    var _dragging = false;
    var _dragStart = { x: 0, y: 0 };

    svg.addEventListener('mousedown', function (e) {
      if (e.target.closest('.star-node-group')) return;
      _dragging = true;
      _dragStart.x = e.clientX;
      _dragStart.y = e.clientY;
      svg.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', function (e) {
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
    });

    window.addEventListener('mouseup', function () {
      if (_dragging) {
        _dragging = false;
        svg.style.cursor = '';
      }
    });

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
      travelBtn.addEventListener('click', function () {
        _dismissTooltip();
        var fuelCost = connection.distance || 10;
        VO.submitTurn({
          type: 'navigation',
          actionId: 'travel_to_' + system.id,
          input:
            'Set course for ' +
            (system.name || 'unknown system') +
            ' (distance: ' +
            (connection.distance || '?') +
            ', estimated fuel: ' +
            fuelCost +
            ')',
        });
      });
    }
  }

  function _dismissTooltip() {
    if (_activeTooltip && _activeTooltip.parentNode) {
      _activeTooltip.parentNode.removeChild(_activeTooltip);
    }
    _activeTooltip = null;
  }
})();
