(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  T.firestore = {
    // ── Worlds ────────────────────────────────────────────

    listWorlds: function (callback) {
      return T.state.db
        .collection('tortuga_worlds')
        .where('shared', '==', true)
        .onSnapshot(
          function (snap) {
            var docs = snap.docs.map(function (d) {
              return Object.assign({ id: d.id }, d.data());
            });
            callback(docs, null);
          },
          function (err) {
            callback(null, err);
          }
        );
    },

    getWorld: function (id) {
      return T.state.db
        .collection('tortuga_worlds')
        .doc(id)
        .get()
        .then(function (snap) {
          if (!snap.exists) throw new Error('World not found.');
          return Object.assign({ id: snap.id }, snap.data());
        });
    },

    createWorld: function (data) {
      var uid = T.state.currentUser.uid;
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db.collection('tortuga_worlds').add(
        Object.assign({}, data, {
          createdBy: uid,
          createdAt: ts,
          updatedAt: ts,
        })
      );
    },

    updateWorld: function (id, data) {
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db
        .collection('tortuga_worlds')
        .doc(id)
        .update(Object.assign({}, data, { updatedAt: ts }));
    },

    onOwnedWorlds: function (callback) {
      var uid = T.state.currentUser.uid;
      return T.state.db
        .collection('tortuga_worlds')
        .where('createdBy', '==', uid)
        .onSnapshot(
          function (snap) {
            var docs = snap.docs.map(function (d) {
              return Object.assign({ id: d.id }, d.data());
            });
            callback(docs, null);
          },
          function (err) {
            callback(null, err);
          }
        );
    },

    deleteWorld: function (id) {
      return T.state.db.collection('tortuga_worlds').doc(id).delete();
    },

    // ── Games ─────────────────────────────────────────────

    listGames: function (callback) {
      var uid = T.state.currentUser.uid;
      return T.state.db
        .collection('tortuga_games')
        .where('owner', '==', uid)
        .onSnapshot(
          function (snap) {
            var docs = snap.docs.map(function (d) {
              return Object.assign({ id: d.id }, d.data());
            });
            callback(docs, null);
          },
          function (err) {
            callback(null, err);
          }
        );
    },

    createGame: function (data) {
      var uid = T.state.currentUser.uid;
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db.collection('tortuga_games').add(
        Object.assign({}, data, {
          owner: uid,
          createdAt: ts,
          lastPlayedAt: ts,
        })
      );
    },

    deleteGame: function (id) {
      return T.state.db.collection('tortuga_games').doc(id).delete();
    },

    createFlagship: function (gameId, data) {
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('ships')
        .add(Object.assign({}, data, { createdAt: ts }));
    },

    updateGame: function (gameId, data) {
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .update(Object.assign({}, data, { updatedAt: ts }));
    },

    updateFlagship: function (gameId, flagshipId, data) {
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('ships')
        .doc(flagshipId)
        .update(Object.assign({}, data, { updatedAt: ts }));
    },

    // ── User prefs / favorites ────────────────────────────

    getFavorites: function (callback) {
      var uid = T.state.currentUser.uid;
      return T.state.db
        .collection('tortuga_user_prefs')
        .doc(uid)
        .onSnapshot(
          function (snap) {
            var favorites = (snap.exists && snap.data().favorites) || [];
            callback(favorites, null);
          },
          function (err) {
            callback([], err);
          }
        );
    },

    toggleFavorite: function (worldId) {
      var uid = T.state.currentUser.uid;
      var ref = T.state.db.collection('tortuga_user_prefs').doc(uid);
      return ref.get().then(function (snap) {
        var favorites = (snap.exists && snap.data().favorites) || [];
        var isFav = favorites.indexOf(worldId) !== -1;
        var op = isFav
          ? firebase.firestore.FieldValue.arrayRemove(worldId)
          : firebase.firestore.FieldValue.arrayUnion(worldId);
        return ref.set({ favorites: op }, { merge: true });
      });
    },

    onGame: function (gameId, callback) {
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .onSnapshot(
          function (snap) {
            if (!snap.exists) {
              callback(null, new Error('Game not found.'));
              return;
            }
            callback(Object.assign({ id: snap.id }, snap.data()), null);
          },
          function (err) {
            callback(null, err);
          }
        );
    },

    onFlagship: function (gameId, flagshipId, callback) {
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('ships')
        .doc(flagshipId)
        .onSnapshot(
          function (snap) {
            if (!snap.exists) {
              callback(null, new Error('Flagship not found.'));
              return;
            }
            callback(Object.assign({ id: snap.id }, snap.data()), null);
          },
          function (err) {
            callback(null, err);
          }
        );
    },

    // ── Decode ────────────────────────────────────────────

    decodeWorld: function (data) {
      function objsToPts(arr) {
        return (arr || []).map(function (o) {
          return [o.y, o.x];
        });
      }
      return Object.assign({}, data, {
        coastlines: (data.coastlines || []).map(function (ring) {
          return objsToPts(ring.pts || ring);
        }),
        settlements: (data.settlements || []).map(function (s) {
          return Object.assign({}, s, {
            position: s.position ? [s.position.y, s.position.x] : null,
          });
        }),
        hazards: (data.hazards || []).map(function (h) {
          return Object.assign({}, h, { polygon: objsToPts(h.polygon) });
        }),
        windCurrentZones: (data.windCurrentZones || []).map(function (wz) {
          return Object.assign({}, wz, { bounds: objsToPts(wz.bounds) });
        }),
        factionTerritory: (data.factionTerritory || []).map(function (ft) {
          return Object.assign({}, ft, { polygon: objsToPts(ft.polygon) });
        }),
        bounds: data.bounds
          ? [
              [data.bounds.minY, data.bounds.minX],
              [data.bounds.maxY, data.bounds.maxX],
            ]
          : null,
      });
    },

    // ── Encode ────────────────────────────────────────────

    encodeWorld: function (decoded) {
      function ptsToObjs(ring) {
        return (ring || []).map(function (pt) {
          return { y: pt[0], x: pt[1] };
        });
      }
      var b = decoded.bounds || [];
      return {
        name: decoded.name || '',
        era: decoded.era || '',
        sourceFormat: decoded.sourceFormat || 'azgaar-json',
        dimensions: decoded.dimensions || {},
        bounds: {
          minY: (b[0] && b[0][0]) || 0,
          minX: (b[0] && b[0][1]) || 0,
          maxY: (b[1] && b[1][0]) || 0,
          maxX: (b[1] && b[1][1]) || 0,
        },
        coastlines: (decoded.coastlines || []).map(function (ring) {
          return { pts: ptsToObjs(ring) };
        }),
        settlements: (decoded.settlements || []).map(function (s) {
          var pos = s.position || s.pos;
          return {
            id: s.id,
            name: s.name,
            type: s.type || null,
            position: pos ? { y: pos[0], x: pos[1] } : null,
            parentFaction: s.parentFaction || s.faction || null,
            baseSize: s.baseSize || null,
            hidden: !!s.hidden,
          };
        }),
        hazards: (decoded.hazards || []).map(function (h) {
          return {
            id: h.id,
            type: h.type,
            polygon: ptsToObjs(h.polygon),
            severity: h.severity || null,
            name: h.name || null,
          };
        }),
        factions: (decoded.factions || []).map(function (f) {
          return {
            id: f.id,
            name: f.name,
            archetype: f.archetype || null,
            color: f.color || null,
            homeSettlementId: f.homeSettlementId || null,
          };
        }),
        tradeRoutes: (decoded.tradeRoutes || []).map(function (r) {
          return { id: r.id, fromId: r.fromId, toId: r.toId, faction: r.faction || null };
        }),
        windCurrentZones: (decoded.windCurrentZones || []).map(function (wz) {
          return {
            id: wz.id,
            name: wz.name || null,
            direction: wz.direction || null,
            strength: wz.strength || null,
            bounds: ptsToObjs(wz.bounds),
          };
        }),
        factionTerritory: (decoded.factionTerritory || []).map(function (ft) {
          return {
            id: ft.id,
            name: ft.name || null,
            faction: ft.faction || null,
            color: ft.color || null,
            polygon: ptsToObjs(ft.polygon),
          };
        }),
      };
    },

    getFlagship: function (gameId, flagshipId) {
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('ships')
        .doc(flagshipId)
        .get()
        .then(function (snap) {
          if (!snap.exists) throw new Error('Flagship not found.');
          return Object.assign({ id: snap.id }, snap.data());
        });
    },

    // ── Captain's Log ─────────────────────────────────────

    addLogEntry: function (gameId, entry) {
      var ts = firebase.firestore.FieldValue.serverTimestamp();
      return T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('log')
        .add(Object.assign({}, entry, { createdAt: ts }));
    },

    loadLogEntries: function (gameId, options) {
      var opts = options || {};
      var query = T.state.db
        .collection('tortuga_games')
        .doc(gameId)
        .collection('log')
        .orderBy('createdAt', 'desc');
      if (opts.startAfter) query = query.startAfter(opts.startAfter);
      query = query.limit(opts.limit || 50);
      return query.get().then(function (snap) {
        return snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
      });
    },
  };
})();
