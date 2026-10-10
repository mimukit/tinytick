import { Action, ActionPanel, Alert, Color, Form, Icon, List, Toast, confirmAlert, openExtensionPreferences, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { OpenApi } from "../api/client";
import { errorMessage } from "../api/errors";
import { getAuth, saveApiToken, saveV2Cookie, signOut, type Auth } from "../auth/secrets";
import { refresh } from "../store/actions";
import { commitSnapshot, useLive } from "../store/live";
import { clearSnapshot, prefs } from "../store/service";
import { EMPTY_SNAPSHOT } from "../store/snapshot";

function useAuth(onChange?: (auth: Auth) => void): [Auth | undefined, () => void] {
  const [auth, setAuth] = useState<Auth>();
  const load = () =>
    void getAuth().then((a) => {
      setAuth(a);
      onChange?.(a);
    }, async (error) => {
      setAuth({});
      await showToast({ style: Toast.Style.Failure, title: "Could not read the Keychain", message: errorMessage(error) });
    });
  useEffect(load, []);
  return [auth, load];
}

/** `onChange` runs after each sign-in state load, so the screen that pushed Account can follow it. */
export function AccountView({ onChange }: { onChange?: (auth: Auth) => void } = {}) {
  const [auth, reload] = useAuth(onChange);
  const { snapshot, loading } = useLive();
  const p = prefs();
  const signedIn = !!auth?.token;
  const status = !auth ? "Checking…" : signedIn ? "Signed in with an API token" : "Not signed in";
  const synced = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString() : "Never";

  return (
    <List isLoading={!auth || loading} navigationTitle="TickTick Account">
      <List.Section title="Status">
        <List.Item
          title={status}
          icon={{ source: signedIn ? Icon.CheckCircle : Icon.XMarkCircle, tintColor: signedIn ? Color.Green : Color.Red }}
        />
        <List.Item
          title="Last sync"
          subtitle={synced}
          icon={Icon.ArrowClockwise}
          accessories={[{ text: `${snapshot.projects.length} lists · ${snapshot.tasks.length} open tasks · ${snapshot.source}` }]}
          actions={
            <ActionPanel>
              <Action title="Sync Now" icon={Icon.ArrowClockwise} onAction={() => void refresh({ full: true })} />
            </ActionPanel>
          }
        />
        <List.Item
          title="v2 extras"
          subtitle={p.enableV2 ? (auth?.v2Cookie ? "On, cookie set" : "On, no cookie") : "Off"}
          icon={Icon.Plug}
          actions={
            <ActionPanel>
              <Action.Push title="Set Session Cookie" icon={Icon.Key} target={<CookieForm onDone={reload} />} />
              <Action title="Open Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
              {auth?.v2Cookie && (
                <Action
                  title="Clear Session Cookie"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    await saveV2Cookie(undefined);
                    reload();
                  }}
                />
              )}
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Sign In">
        <List.Item
          title="Sign in with an API token"
          subtitle="TickTick Settings › Account › API Token"
          icon={Icon.Key}
          actions={
            <ActionPanel>
              <Action.Push title="Enter API Token" icon={Icon.Key} target={<TokenForm onDone={reload} />} />
            </ActionPanel>
          }
        />
        {(signedIn || auth?.v2Cookie) && (
          <List.Item
            title="Sign out"
            subtitle="Removes the token, the cookie and the cache"
            icon={{ source: Icon.Logout, tintColor: Color.Red }}
            actions={
              <ActionPanel>
                <Action
                  title="Sign Out"
                  icon={Icon.Logout}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    const ok = await confirmAlert({
                      title: "Sign out of TickTick?",
                      message: "This removes the stored token, the v2 cookie and the local cache.",
                      primaryAction: { title: "Sign Out", style: Alert.ActionStyle.Destructive },
                    });
                    if (!ok) return;
                    await signOut();
                    clearSnapshot();
                    commitSnapshot(EMPTY_SNAPSHOT);
                    reload();
                    await showToast({ style: Toast.Style.Success, title: "Signed out" });
                  }}
                />
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}

export function TokenForm({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  const [busy, setBusy] = useState(false);
  return (
    <Form
      isLoading={busy}
      navigationTitle="API Token"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Token"
            icon={Icon.Key}
            onSubmit={async (values: { token: string }) => {
              const token = values.token.trim();
              if (!token) return;
              setBusy(true);
              try {
                await new OpenApi(token).listProjects();
                await saveApiToken(token);
                onDone();
                pop();
                await refresh({ full: true });
              } catch (error) {
                await showToast({ style: Toast.Style.Failure, title: "TickTick rejected the token", message: errorMessage(error) });
              } finally {
                setBusy(false);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Create a token in TickTick: Settings › Account › API Token. tinytick stores it in the macOS Keychain." />
      <Form.PasswordField id="token" title="API token" />
    </Form>
  );
}

function CookieForm({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="v2 Session Cookie"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Cookie"
            icon={Icon.Key}
            onSubmit={async (values: { cookie: string }) => {
              if (!values.cookie.trim()) return;
              await saveV2Cookie(values.cookie);
              onDone();
              pop();
              if (prefs().enableV2) await refresh({ full: true });
              else await showToast({ style: Toast.Style.Success, title: "Cookie saved", message: "Turn on the v2 preference to use it." });
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Sign in at ticktick.com in a browser, open the developer tools, and copy the value of the cookie named t. tinytick stores it in the macOS Keychain. The v2 API is unofficial and can break." />
      <Form.PasswordField id="cookie" title="Cookie t" />
    </Form>
  );
}
