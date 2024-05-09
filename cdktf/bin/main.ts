import { App } from "cdktf";
import { Aws } from "../lib/aws";
import { Azure } from "../lib/azure";
import { Gcp } from "../lib/gcp";

const app = new App();
new Aws(app, "gha-runners-on-ecs");
new Azure(app, 'gha-runners-on-aca');
new Gcp(app, 'gha-runners-on-cr');
app.synth();
