import { App } from "cdktf";
import { Aws } from "../lib/aws";

const app = new App();
new Aws(app, "gha-runners-on-managed-env");
app.synth();
