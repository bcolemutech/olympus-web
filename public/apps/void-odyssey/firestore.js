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

  // ── Subcollection helpers ─────────────────────────────────

  /** Helper: resolve a subcollection query snapshot to an array. */
  function _snapshotToArray(snapshot) {
    var results = [];
    snapshot.forEach(function (doc) {
      results.push(Object.assign({ id: doc.id }, doc.data()));
    });
    return results;
  }

  /** Helper: get a game subcollection reference. */
  function _subRef(gameId, subcollection) {
    return VO.state.db.collection('void_odyssey_games').doc(gameId).collection(subcollection);
  }

  /**
   * Load all crew members for a game, ordered by name.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadCrew = function (gameId) {
    return _subRef(gameId, 'crew').orderBy('name').get().then(_snapshotToArray);
  };

  /**
   * Fetch a single crew member.
   * @param {string} gameId
   * @param {string} crewId
   * @returns {Promise<object|null>}
   */
  VO.getCrewMember = function (gameId, crewId) {
    return _subRef(gameId, 'crew')
      .doc(crewId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };

  /**
   * Load all items for a game.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadItems = function (gameId) {
    return _subRef(gameId, 'items').get().then(_snapshotToArray);
  };

  /**
   * Load all entities for a game.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadEntities = function (gameId) {
    return _subRef(gameId, 'entities').get().then(_snapshotToArray);
  };

  /**
   * Fetch a single entity.
   * @param {string} gameId
   * @param {string} entityId
   * @returns {Promise<object|null>}
   */
  VO.getEntity = function (gameId, entityId) {
    return _subRef(gameId, 'entities')
      .doc(entityId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };

  /**
   * Load all locations for a game.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadLocations = function (gameId) {
    return _subRef(gameId, 'locations').get().then(_snapshotToArray);
  };

  /**
   * Fetch a single location.
   * @param {string} gameId
   * @param {string} locationId
   * @returns {Promise<object|null>}
   */
  VO.getLocation = function (gameId, locationId) {
    return _subRef(gameId, 'locations')
      .doc(locationId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };

  /**
   * Load all star map systems for a game.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadStarMap = function (gameId) {
    return _subRef(gameId, 'star_map').get().then(_snapshotToArray);
  };

  /**
   * Fetch a single star map system.
   * @param {string} gameId
   * @param {string} systemId
   * @returns {Promise<object|null>}
   */
  VO.getStarMapSystem = function (gameId, systemId) {
    return _subRef(gameId, 'star_map')
      .doc(systemId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };

  /**
   * Load all quests for a game.
   * @param {string} gameId
   * @returns {Promise<Array>}
   */
  VO.loadQuests = function (gameId) {
    return _subRef(gameId, 'quests').get().then(_snapshotToArray);
  };

  /**
   * Fetch a single quest.
   * @param {string} gameId
   * @param {string} questId
   * @returns {Promise<object|null>}
   */
  VO.getQuest = function (gameId, questId) {
    return _subRef(gameId, 'quests')
      .doc(questId)
      .get()
      .then(function (doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      });
  };

  /**
   * Load narrative log entries, ordered by turnNumber desc.
   * @param {string} gameId
   * @param {object} [options]
   * @param {number} [options.limit] - Max entries to return (default 50)
   * @param {*} [options.startAfter] - Firestore doc snapshot for pagination
   * @returns {Promise<Array>}
   */
  VO.loadNarrativeLog = function (gameId, options) {
    var opts = options || {};
    var query = _subRef(gameId, 'narrative_log').orderBy('turnNumber', 'desc');
    if (opts.startAfter) {
      query = query.startAfter(opts.startAfter);
    }
    query = query.limit(opts.limit || 50);
    return query.get().then(_snapshotToArray);
  };

  /**
   * Load narrative log entries filtered by mood.
   * @param {string} gameId
   * @param {string} mood
   * @returns {Promise<Array>}
   */
  VO.loadNarrativeLogByMood = function (gameId, mood) {
    return _subRef(gameId, 'narrative_log')
      .where('mood', '==', mood)
      .orderBy('turnNumber', 'desc')
      .limit(50)
      .get()
      .then(_snapshotToArray);
  };
})();
