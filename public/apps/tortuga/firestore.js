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
  };
})();
