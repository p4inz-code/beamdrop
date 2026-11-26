const path = require('path');
const os = require('os');
const { BeamDropServer } = require('./server');
const { getNetworkInterfaces } = require('./network');

async function main() {
  const saveDir = path.join(os.homedir(), 'Downloads', 'BeamDrop');
  const server = new BeamDropServer({
    port: Number(process.env.BEAMDROP_PORT || 5050),
    saveDir,
    requireApproval: false
  });

  const port = await server.start();
  const { recommended } = getNetworkInterfaces();
  console.log(`BeamDrop Server running at http://${recommended.address}:${port}`);
  console.log(`PIN: ${server.pin}`);
  console.log(`Save Dir: ${saveDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
