import { App } from "cdktf";
import { Aws } from "../lib/aws";
import { Azure } from "../lib/azure";

const app = new App();
new Aws(app, "gha-runners-on-ecs");
new Azure(app, 'gha-runners-on-aca');
app.synth();
