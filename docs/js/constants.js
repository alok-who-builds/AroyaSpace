// Shared event names. backend/constants.js and frontend/js/constants.js are
// identical copies (GitHub Pages can't reach ../backend), keep them in sync.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.US = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    PEOPLE: { batman: 'Batman', cinderella: 'Cinderella' },
    EVENTS: {
      STATE: 'state',            // server -> client: personal snapshot
      GET_STATE: 'state:get',
      TX_ADD: 'tx:add',
      TX_ADJUST: 'tx:adjust',
      WISH_ADD: 'wish:add',
      WISH_UPDATE: 'wish:update',
      WISH_DELETE: 'wish:delete',
      WISH_BUY: 'wish:buy',
      GOAL_ADD: 'goal:add',
      GOAL_UPDATE: 'goal:update',
      GOAL_ALLOCATE: 'goal:allocate',
      GOAL_SPEND: 'goal:spend',
      MEMORY_ADD: 'memory:add',
      MEMORY_DELETE: 'memory:delete',
      MESSAGE_SET: 'message:set'
    }
  };
});
