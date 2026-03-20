(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  function _barColor(pct) {
    if (pct > 60) return 'hud-bar-green';
    if (pct > 30) return 'hud-bar-yellow';
    return 'hud-bar-red';
  }

  function _setPct(barId, pctId, value, max) {
    var pct = max > 0 ? Math.round((value / max) * 100) : 0;
    var bar = document.getElementById(barId);
    var label = document.getElementById(pctId);
    if (bar) {
      bar.style.width = pct + '%';
      bar.className = 'hud-progress-fill ' + _barColor(pct);
    }
    if (label) {
      label.textContent = pct + '%';
    }
  }

  /**
   * Full HUD render from a game document.
   */
  VO.renderHud = function (game) {
    var ship = game.ship || {};

    var shipName = document.getElementById('hud-ship-name');
    if (shipName) shipName.textContent = ship.name || '—';

    var location = document.getElementById('hud-location');
    if (location) location.textContent = game.currentLocationName || '—';

    var turnCount = document.getElementById('hud-turn-count');
    if (turnCount) turnCount.textContent = game.turnCount || 0;

    var crewCount = document.getElementById('hud-crew-count');
    if (crewCount) {
      var countText = '—';
      if (game.crewCount != null) {
        countText = game.crewCount;
      } else if (Array.isArray(game.activeCrew)) {
        countText = game.activeCrew.length;
      }
      crewCount.textContent = countText;
    }

    _setPct('hud-hull-bar', 'hud-hull-pct', ship.hull || 0, ship.hullMax || 100);
    _setPct('hud-shields-bar', 'hud-shields-pct', ship.shields || 0, ship.shieldsMax || 100);
    _setPct('hud-fuel-bar', 'hud-fuel-pct', ship.fuel || 0, 100);
  };

  /**
   * Partial HUD update after a turn completes.
   */
  VO.updateHud = function (data) {
    if (data.shipStatus) {
      _setPct('hud-hull-bar', 'hud-hull-pct', data.shipStatus.hull, data.shipStatus.hullMax);
      _setPct(
        'hud-shields-bar',
        'hud-shields-pct',
        data.shipStatus.shields,
        data.shipStatus.shieldsMax
      );
      _setPct('hud-fuel-bar', 'hud-fuel-pct', data.shipStatus.fuel, 100);
    }

    if (data.turnCount !== undefined) {
      var turnCount = document.getElementById('hud-turn-count');
      if (turnCount) turnCount.textContent = data.turnCount;
    }

    if (data.locationName) {
      var location = document.getElementById('hud-location');
      if (location) location.textContent = data.locationName;
    }

    if (data.crewCount !== undefined) {
      var crewCount = document.getElementById('hud-crew-count');
      if (crewCount) crewCount.textContent = data.crewCount;
    }
  };
})();
