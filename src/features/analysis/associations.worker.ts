// Web Worker: calcola le associazioni fuori dal thread principale. Riceve i dati già letti.
import { handleAssociationsRequest, type AssociationsRequest, type AssociationsResponse } from "./associationsJob";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AssociationsRequest>) => void) | null;
  postMessage: (message: AssociationsResponse) => void;
};

scope.onmessage = (event) => {
  const response = handleAssociationsRequest(event.data);
  if (response) scope.postMessage(response);
};
