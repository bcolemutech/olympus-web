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
  };
})();
