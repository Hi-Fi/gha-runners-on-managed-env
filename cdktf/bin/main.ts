import { App } from "cdktf";
import { Aws } from "../lib/aws";
import { Azure } from "../lib/azure";
import { Gcp } from "../lib/gcp";
import { Autopilot } from "../lib/autopilot";

const app = new App();
new Aws(app, "gha-runners-on-ecs");
new Azure(app, 'gha-runners-on-aca');
new Gcp(app, 'gha-runners-on-cr');
new Autopilot(app, 'gha-runners-on-gke');
app.synth();
