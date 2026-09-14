import {
  EdgelessAutoConnectWidget,
  NOTESGRAPH_EDGELESS_AUTO_CONNECT_WIDGET,
} from '.';

export function effects() {
  customElements.define(
    NOTESGRAPH_EDGELESS_AUTO_CONNECT_WIDGET,
    EdgelessAutoConnectWidget
  );
}
