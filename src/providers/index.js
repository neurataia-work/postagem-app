const { facebook, instagram } = require('./meta');
const providers = {
  facebook, instagram,
  linkedin: require('./linkedin'),
  x: require('./x'),
  tiktok: require('./tiktok'),
  demo: require('./demo'),
};
module.exports = providers;
