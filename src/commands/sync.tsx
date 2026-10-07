import { showHUD } from "@raycast/api";
import { errorMessage } from "../api/errors";
import { syncNow } from "../store/service";

export default async function Command() {
  try {
    const snapshot = await syncNow({ full: true });
    await showHUD(`Synced ${snapshot.projects.length} lists, ${snapshot.tasks.length} tasks`);
  } catch (error) {
    await showHUD(`Sync failed: ${errorMessage(error)}`);
  }
}
