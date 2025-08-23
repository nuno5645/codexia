// app/settings/page.tsx
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Provider, useSettingsStore } from "@/stores/SettingsStore";
import { useAuthStore, useIsAuthenticated } from "@/stores/AuthStore";
import { AuthDialog } from "@/components/dialogs/AuthDialog";
import { Badge } from "@/components/ui/badge";
import { User, AlertCircle, Check } from "lucide-react";

export default function SettingsPage() {
  const {
    providers,
    setProviderBaseUrl,
    setProviderModels,
  } = useSettingsStore();
  const isAuthenticated = useIsAuthenticated();
  const authState = useAuthStore((state) => state.auth);
  const [activeSection, setActiveSection] = useState("provider");
  const [selectedProvider, setSelectedProvider] = useState<string>("openai");
  const [newModelName, setNewModelName] = useState("");
  const [editingModelIdx, setEditingModelIdx] = useState<number | null>(null);
  const [editingModelValue, setEditingModelValue] = useState("");
  const providerNames = [
    "openai",
    "gemini",
    "ollama",
    "openrouter",
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 border-r bg-muted/30 px-4 space-y-2">
        <Button
          variant={activeSection === "provider" ? "default" : "ghost"}
          className="w-full justify-start"
          onClick={() => setActiveSection("provider")}
        >
          Provider
        </Button>
        <Button
          variant={activeSection === "security" ? "default" : "ghost"}
          className="w-full justify-start"
          onClick={() => setActiveSection("security")}
        >
          Security
        </Button>
        <Button
          variant={activeSection === "working" ? "default" : "ghost"}
          className="w-full justify-start"
          onClick={() => setActiveSection("working")}
        >
          Working Directory
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 overflow-y-auto">
        {activeSection === "provider" && (
          <div className="grid grid-cols-3 gap-6">
            {/* Left: Providers */}
            <Card className="col-span-1">
              <CardContent className="p-4 space-y-2">
                {providerNames.map((p) => (
                  <Button
                    key={p}
                    variant={selectedProvider === p ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => setSelectedProvider(p)}
                  >
                    {p}
                  </Button>
                ))}
              </CardContent>
            </Card>

            {/* Right: Models */}
            <Card className="col-span-2">
              <CardContent className="p-4">
                <h2 className="text-lg font-semibold mb-4">
                  {selectedProvider} Configuration
                </h2>
                
                {/* Authentication Status */}
                <div className="mb-6">
                  <label className="block mb-2 font-medium">Authentication</label>
                  <Card className="p-4">
                    {!isAuthenticated ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <AlertCircle className="w-4 h-4" />
                          <span>Not authenticated</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Sign in to access AI models and sync your conversations.
                        </p>
                        <AuthDialog />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {authState.type === 'api_key' ? (
                            <>
                              <Check className="w-4 h-4 text-green-600" />
                              <span>API Key</span>
                              <Badge variant="outline">Active</Badge>
                            </>
                          ) : (
                            <>
                              <User className="w-4 h-4 text-green-600" />
                              <span>ChatGPT</span>
                              {authState.email && (
                                <Badge variant="outline">{authState.email}</Badge>
                              )}
                              {authState.plan && (
                                <Badge variant="secondary">{authState.plan}</Badge>
                              )}
                            </>
                          )}
                        </div>
                        <AuthDialog />
                      </div>
                    )}
                  </Card>
                </div>
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Base URL</label>
                  <Input
                    type="text"
                    value={providers[selectedProvider as Provider]?.baseUrl || ""}
                    onChange={(e) =>
                      setProviderBaseUrl(selectedProvider as Provider, e.target.value)
                    }
                    placeholder={`Enter base URL for ${selectedProvider}`}
                  />
                </div>
                {/* show models */}
                <div className="mb-4">
                  <label className="block mb-1 font-medium">Models</label>
                  <div className="flex gap-2 mb-2">
                    <Input
                      type="text"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const trimmed = newModelName.trim();
                          if (!trimmed) return;
                          const provider = selectedProvider as Provider;
                          if ((providers[provider]?.models || []).includes(trimmed)) {
                            setNewModelName("");
                            return;
                          }
                          setProviderModels(provider, [
                            ...(providers[provider]?.models || []),
                            trimmed,
                          ]);
                          setNewModelName("");
                        }
                      }}
                      placeholder="Add new model"
                      className="flex-1"
                    />
                    <Button
                      onClick={() => {
                        const trimmed = newModelName.trim();
                        if (!trimmed) return;
                        const provider = selectedProvider as Provider;
                        if ((providers[provider]?.models || []).includes(trimmed)) {
                          setNewModelName("");
                          return;
                        }
                        setProviderModels(provider, [
                          ...(providers[provider]?.models || []),
                          trimmed,
                        ]);
                        setNewModelName("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <ul className="list-disc list-inside mb-2">
                    {(providers[selectedProvider as Provider]?.models || []).map(
                      (model, idx) => (
                        <li
                          key={model + idx}
                          className="flex items-center justify-between py-1"
                        >
                          {editingModelIdx === idx ? (
                            <div className="flex gap-2 flex-1">
                              <Input
                                type="text"
                                value={editingModelValue}
                                onChange={(e) =>
                                  setEditingModelValue(e.target.value)
                                }
                                className="flex-1"
                              />
                              <Button
                                onClick={() => {
                                  const trimmed = editingModelValue.trim();
                                  if (!trimmed) return;
                                  const provider = selectedProvider as Provider;
                                  const newModels = [
                                    ...(providers[provider]?.models || []),
                                  ];
                                  newModels[idx] = trimmed;
                                  setProviderModels(provider, newModels);
                                  setEditingModelIdx(null);
                                  setEditingModelValue("");
                                }}
                              >
                                Save
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => {
                                  setEditingModelIdx(null);
                                  setEditingModelValue("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <span>{model}</span>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setEditingModelIdx(idx);
                                    setEditingModelValue(model);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    const provider =
                                      selectedProvider as Provider;
                                    const newModels = (
                                      providers[provider]?.models || []
                                    ).filter((_, i) => i !== idx);
                                    setProviderModels(provider, newModels);
                                  }}
                                >
                                  Delete
                                </Button>
                              </div>
                            </>
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        {activeSection === "security" && <p>Security Settings</p>}
        {activeSection === "working" && <p>Working Directory Settings</p>}
      </div>
    </div>
  );
}
