import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function LoginScreen() {
  const { session, login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordLoginAvailable = session?.passwordLoginAvailable ?? false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    const r = await login(password);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error ?? "login failed");
      setPassword("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-mono p-6">
      <Card className="w-full max-w-md bg-card border-border/50">
        <CardContent className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-widest text-primary uppercase">
              QueenSync
            </h1>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Operator authentication required
            </p>
          </div>

          {passwordLoginAvailable ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-xs uppercase">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  data-testid="input-login-password"
                  placeholder="Operator or viewer password"
                  className="mt-1"
                />
              </div>
              {error && (
                <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 px-3 py-2 rounded">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                disabled={!password || submitting}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/80"
                data-testid="button-login"
              >
                {submitting ? "Authenticating…" : "Sign in"}
              </Button>
            </form>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground border border-border/50 rounded p-4">
              <p>
                Password sign-in is disabled on this server.
              </p>
              <p>
                Authenticate programmatically with{" "}
                <code className="text-foreground/80">
                  Authorization: Bearer &lt;token&gt;
                </code>
                . Configure{" "}
                <code className="text-foreground/80">
                  QUEENSYNC_OPERATOR_PASSWORD
                </code>{" "}
                to enable browser sign-in.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
