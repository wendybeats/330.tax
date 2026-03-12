"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Unlink, Loader2 } from "lucide-react";

interface ConnectedAccountsProps {
  email: string;
  hasGoogleToken: boolean;
}

export function ConnectedAccounts({
  email,
  hasGoogleToken,
}: ConnectedAccountsProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [connected, setConnected] = useState(hasGoogleToken);

  async function handleDisconnect() {
    setDisconnecting(true);

    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from("users")
        .update({ google_refresh_token: null })
        .eq("id", user.id);
      setConnected(false);
    }

    setDisconnecting(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>
          Manage your connected services and data sources.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="size-5 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Google Account</p>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {connected ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Connected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unlink className="size-4" />
                  )}
                  Disconnect
                </Button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                Disconnected
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
