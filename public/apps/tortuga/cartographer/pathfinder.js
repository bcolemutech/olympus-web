(function () {
  'use strict';

  /*
   * Tortuga water-pathfinder — used by overlay.applyOverlay to bend trade routes
   * around landmasses instead of drawing straight lines through islands.
   *
   * Two-step pipeline:
   *   buildLandMask(bounds, coastlines, gridSize)
   *     Rasterises coastline polygons into a square land/water grid by bbox-
   *     filtered ray-cast point-in-polygon on each cell centre.
   *
   *   findPath(meta, fromWorld, toWorld)
   *     8-connected A* with octile-distance heuristic across the water cells,
   *     then drops collinear intermediate points so the result is a polyline
   *     of turn vertices in world coords (y, x).
   *
   * If start or end falls on land (ports sit on the coastline, so this is
   * common), we BFS up to 5 cells outward to find the nearest water cell.
   * If no path is found (e.g. ports on disconnected seas), returns null and
   * the caller falls back to a straight line.
   */

  var DEFAULT_GRID_SIZE = 160;

  function _bbox(poly) {
    var minY = Infinity,
      minX = Infinity,
      maxY = -Infinity,
      maxX = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      if (p[0] < minY) minY = p[0];
      if (p[0] > maxY) maxY = p[0];
      if (p[1] < minX) minX = p[1];
      if (p[1] > maxX) maxX = p[1];
    }
    return [minY, minX, maxY, maxX];
  }

  function _pointInPolygon(y, x, poly) {
    var inside = false;
    var n = poly.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var yi = poly[i][0],
        xi = poly[i][1];
      var yj = poly[j][0],
        xj = poly[j][1];
      var intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function buildLandMask(bounds, coastlines, gridSize) {
    gridSize = gridSize || DEFAULT_GRID_SIZE;
    var minY = bounds[0][0],
      minX = bounds[0][1];
    var maxY = bounds[1][0],
      maxX = bounds[1][1];
    var cellH = (maxY - minY) / gridSize;
    var cellW = (maxX - minX) / gridSize;
    var mask = new Uint8Array(gridSize * gridSize);

    if (!coastlines) {
      return { mask: mask, gridSize: gridSize, minY: minY, minX: minX, cellH: cellH, cellW: cellW };
    }

    for (var p = 0; p < coastlines.length; p++) {
      var poly = coastlines[p];
      if (!poly || poly.length < 3) continue;
      var bb = _bbox(poly);
      var iMin = Math.max(0, Math.floor((bb[0] - minY) / cellH));
      var iMax = Math.min(gridSize - 1, Math.floor((bb[2] - minY) / cellH));
      var jMin = Math.max(0, Math.floor((bb[1] - minX) / cellW));
      var jMax = Math.min(gridSize - 1, Math.floor((bb[3] - minX) / cellW));
      for (var i = iMin; i <= iMax; i++) {
        var cy = minY + (i + 0.5) * cellH;
        for (var j = jMin; j <= jMax; j++) {
          var idx = i * gridSize + j;
          if (mask[idx]) continue;
          var cx = minX + (j + 0.5) * cellW;
          if (_pointInPolygon(cy, cx, poly)) mask[idx] = 1;
        }
      }
    }

    return { mask: mask, gridSize: gridSize, minY: minY, minX: minX, cellH: cellH, cellW: cellW };
  }

  function _worldToGrid(meta, y, x) {
    var i = Math.floor((y - meta.minY) / meta.cellH);
    var j = Math.floor((x - meta.minX) / meta.cellW);
    if (i < 0) i = 0;
    if (i >= meta.gridSize) i = meta.gridSize - 1;
    if (j < 0) j = 0;
    if (j >= meta.gridSize) j = meta.gridSize - 1;
    return [i, j];
  }

  function _gridToWorld(meta, i, j) {
    return [meta.minY + (i + 0.5) * meta.cellH, meta.minX + (j + 0.5) * meta.cellW];
  }

  // BFS outward in square rings to find the nearest water cell within maxRadius.
  function _nearestWater(meta, i, j, maxRadius) {
    var n = meta.gridSize;
    if (!meta.mask[i * n + j]) return [i, j];
    for (var r = 1; r <= maxRadius; r++) {
      for (var di = -r; di <= r; di++) {
        for (var dj = -r; dj <= r; dj++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          var ni = i + di,
            nj = j + dj;
          if (ni < 0 || ni >= n || nj < 0 || nj >= n) continue;
          if (!meta.mask[ni * n + nj]) return [ni, nj];
        }
      }
    }
    return null;
  }

  // Min-heap keyed on f-score. No decrease-key — stale entries are filtered
  // in the A* main loop via the closed-set check.
  function _Heap() {
    this.data = [];
  }
  _Heap.prototype.push = function (node) {
    this.data.push(node);
    var i = this.data.length - 1;
    while (i > 0) {
      var pIdx = (i - 1) >> 1;
      if (this.data[pIdx].f <= this.data[i].f) break;
      var t = this.data[pIdx];
      this.data[pIdx] = this.data[i];
      this.data[i] = t;
      i = pIdx;
    }
  };
  _Heap.prototype.pop = function () {
    if (this.data.length === 0) return null;
    var top = this.data[0];
    var last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      var i = 0,
        n = this.data.length;
      while (true) {
        var l = 2 * i + 1,
          r = 2 * i + 2,
          s = i;
        if (l < n && this.data[l].f < this.data[s].f) s = l;
        if (r < n && this.data[r].f < this.data[s].f) s = r;
        if (s === i) break;
        var t = this.data[s];
        this.data[s] = this.data[i];
        this.data[i] = t;
        i = s;
      }
    }
    return top;
  };
  _Heap.prototype.size = function () {
    return this.data.length;
  };

  var DIRS = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [1, 1, Math.SQRT2],
  ];

  function _octile(i, j, ti, tj) {
    var di = Math.abs(i - ti),
      dj = Math.abs(j - tj);
    return di + dj + (Math.SQRT2 - 2) * Math.min(di, dj);
  }

  function _astar(meta, si, sj, ti, tj) {
    var n = meta.gridSize;
    var open = new _Heap();
    var gScore = new Float32Array(n * n);
    var came = new Int32Array(n * n);
    var visited = new Uint8Array(n * n);
    for (var k = 0; k < n * n; k++) {
      gScore[k] = Infinity;
      came[k] = -1;
    }
    var sIdx = si * n + sj;
    gScore[sIdx] = 0;
    open.push({ i: si, j: sj, f: _octile(si, sj, ti, tj) });

    while (open.size() > 0) {
      var cur = open.pop();
      var cIdx = cur.i * n + cur.j;
      if (visited[cIdx]) continue;
      visited[cIdx] = 1;
      if (cur.i === ti && cur.j === tj) {
        var path = [];
        var k2 = cIdx;
        while (k2 !== -1) {
          path.push([Math.floor(k2 / n), k2 % n]);
          k2 = came[k2];
        }
        path.reverse();
        return path;
      }
      for (var d = 0; d < DIRS.length; d++) {
        var ni = cur.i + DIRS[d][0],
          nj = cur.j + DIRS[d][1],
          cost = DIRS[d][2];
        if (ni < 0 || ni >= n || nj < 0 || nj >= n) continue;
        var nIdx = ni * n + nj;
        if (meta.mask[nIdx]) continue;
        if (visited[nIdx]) continue;
        var tentG = gScore[cIdx] + cost;
        if (tentG >= gScore[nIdx]) continue;
        gScore[nIdx] = tentG;
        came[nIdx] = cIdx;
        open.push({ i: ni, j: nj, f: tentG + _octile(ni, nj, ti, tj) });
      }
    }
    return null;
  }

  // Drop collinear interior points via cross-product epsilon.
  function _simplify(path) {
    if (path.length <= 2) return path.slice();
    var result = [path[0]];
    for (var i = 1; i < path.length - 1; i++) {
      var a = result[result.length - 1],
        b = path[i],
        c = path[i + 1];
      var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) > 1e-6) result.push(b);
    }
    result.push(path[path.length - 1]);
    return result;
  }

  function findPath(meta, fromWorld, toWorld) {
    var s = _worldToGrid(meta, fromWorld[0], fromWorld[1]);
    var t = _worldToGrid(meta, toWorld[0], toWorld[1]);
    var sw = _nearestWater(meta, s[0], s[1], 5);
    var tw = _nearestWater(meta, t[0], t[1], 5);
    if (!sw || !tw) return null;
    var gridPath = _astar(meta, sw[0], sw[1], tw[0], tw[1]);
    if (!gridPath || gridPath.length < 2) return null;
    var worldPath = gridPath.map(function (g) {
      return _gridToWorld(meta, g[0], g[1]);
    });
    // Snap endpoints to the actual port positions so polylines visibly connect.
    worldPath[0] = fromWorld;
    worldPath[worldPath.length - 1] = toWorld;
    return _simplify(worldPath);
  }

  var api = {
    buildLandMask: buildLandMask,
    findPath: findPath,
    DEFAULT_GRID_SIZE: DEFAULT_GRID_SIZE,
  };

  if (typeof window !== 'undefined') {
    window.Tortuga = window.Tortuga || {};
    window.Tortuga.pathfinder = api;
  }

  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
})();
