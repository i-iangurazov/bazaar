// Local QA only; explicitly preloaded by the subscription runtime, never by the app.
const os = require("node:os");
const cpus = os.cpus;
os.cpus = () => cpus().slice(0, 2);
os.availableParallelism = () => 2;
require("node:module").syncBuiltinESMExports();
