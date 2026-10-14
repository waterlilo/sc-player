import { Component, type ReactNode } from "react";
import { ErrorState } from "./States";

/**
 * A screen that throws while rendering shows the usual error with a retry button instead of blanking the whole
 * window; the sidebar and the player keep working. Keyed by the route, so moving to another page clears it.
 */
export default class ScreenBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("screen crashed", error);
  }

  render() {
    if (this.state.error) return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
