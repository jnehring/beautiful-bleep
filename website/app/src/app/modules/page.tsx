// SPDX-License-Identifier: MIT
import { Redirect } from "../Redirect";

/** The module reference is part of the Bleep Store now. */
export default function Modules() {
  return <Redirect to="/store/?kind=module" />;
}
