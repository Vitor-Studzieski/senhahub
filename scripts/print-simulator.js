// Simulator uses the identical v2 protocol and requires an explicitly provisioned
// test-only device capability. It cannot consume a normal production destination.
const {loadAgentEnvironment}=require('./print-agent/runtime');
loadAgentEnvironment();
process.argv.push('--simulate');
require('./print-agent').main().catch(error=>{console.error(error.message);process.exitCode=1;});
