(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  /**
   * Load all games belonging to the current user, ordered by most recently updated.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  VO.loadUserGames = function (userId) {
    return VO.state.db
      .collection('void_odyssey_games')
      .where('userId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .get()
      .then(function (snapshot) {
        var games = [];
        snapshot.forEach(function (doc) {
          games.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return games;
      });
  };

  /**
   * Fetch a single game document.
   * @param {string} gameId
   * @returns {Promise<object|null>}
   */
  VO.getGame = function (gameId) {
    return VO.state.db
      .collection('void_odyssey_games')
      .doc(gameId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };
})();
