// Eliminazione definitiva di un cliente, con conferma scrivendo il nome.
import { api } from "../api.js";

export async function confirmAndDeleteClient(client) {
  const typed = window.prompt(
    `Eliminare definitivamente "${client.name}"?\n\nVerranno cancellati anagrafica, collegamenti social, statistiche e chat. L'operazione non si può annullare.\n\nPer confermare scrivi il nome del cliente:`
  );
  if (typed === null) return false;
  try {
    await api.deleteClient(client.id, typed);
    return true;
  } catch (e) {
    window.alert(e.message);
    return false;
  }
}
