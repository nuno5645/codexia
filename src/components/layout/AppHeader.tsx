import { PartyPopper, Usb, PanelLeft, Settings, MessageCircleCode, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "react-router-dom";
import { useLayoutStore } from "@/stores/layoutStore";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import { McpDialog } from "../dialogs/McpDialog";
import { AuthDialog } from "../dialogs/AuthDialog";

export function AppHeader() {
  const { showFileTree, toggleFileTree } = useLayoutStore();
  const [codexVersion, setCodexVersion] = useState<string>("");
  const [isCodexAvailable, setIsCodexAvailable] = useState<boolean>(false);
  const location = useLocation();

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const version = await invoke<string>("check_codex_version");
        setCodexVersion(version);
        setIsCodexAvailable(true);
      } catch (error) {
        setCodexVersion("Not available");
        setIsCodexAvailable(false);
      }
    };

    checkVersion();
  }, []);

  return (
    <div data-tauri-drag-region className="flex justify-between px-2">
      <span className="flex gap-2 items-center">
        <div
          className={`w-2 h-2 rounded-full ${isCodexAvailable ? "bg-green-500" : "bg-red-500"}`}
        ></div>
        <Badge>{codexVersion}</Badge>
        {/* Welcome button to projects page */}
        <Link to="/" className="flex hover:text-blue-500 items-center gap-1">
          <PartyPopper className="w-5 h-5" /> Projects
        </Link>

        <Link to="/chat" className="flex hover:text-blue-500 items-center gap-1">
          <MessageCircleCode className="w-5 h-5" /> Chat
        </Link>

        {location.pathname === "/chat" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFileTree}
            className={`h-6 w-6 ${showFileTree ? "bg-primary/20" : ""}`}
          >
            <PanelLeft className="w-3 h-3" />
          </Button>
        )}
      </span>

      <span className="flex gap-2">
        {location.pathname === "/chat" && (
          <McpDialog>
            <Button variant="ghost" className="flex gap-1">
              <Usb />
              MCP
            </Button>
          </McpDialog>
        )}

        <Link to="/usage" className="flex hover:text-blue-500 items-center gap-1">
          <BarChart3 className="w-4 h-4" /> Usage
        </Link>

        <Link to="/settings" className="flex items-center gap-1">
          <Settings className="w-4 h-4" />
          Settings
        </Link>

        <AuthDialog />
      </span>
    </div>
  );
}
