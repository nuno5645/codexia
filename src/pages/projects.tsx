import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { safeInvoke } from "@/utils/tauriMock";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FolderOpen, Plus } from "lucide-react";
import { useFolderStore } from "@/stores/FolderStore";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layoutStore";
import { open } from "@tauri-apps/plugin-dialog";

interface Project {
  path: string;
  trust_level: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { setCurrentFolder } = useFolderStore();
  const { setFileTree, setChatPane } = useLayoutStore();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const projectList = await safeInvoke('read_codex_config') as Project[];
      setProjects(projectList);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const openProject = (projectPath: string) => {
    setCurrentFolder(projectPath);
    // Enable both panels when opening a project
    setFileTree(true);
    setChatPane(true);
    // Navigate to chat page
    navigate("/chat");
  };

  const selectNewProject = async () => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
      });
      if (result) {
        openProject(result);
      }
    } catch (error) {
      console.error("Failed to select directory:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div>Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="w-full">
          <div className="flex items-center justify-between w-full">
            <h1 className="text-2xl font-bold">Projects</h1>
            <Button onClick={selectNewProject}>
              <Plus className="w-3 h-3" />
              Open Project
            </Button>
          </div>
          <p className="text-muted-foreground">Manage your Codex projects</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No projects found</h3>
            <p className="text-muted-foreground">
              run codex at project to see them here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 grid grid-cols-1 md:grid-cols-2">
          {projects.map((project, index) => {
            const projectName =
              project.path.split(/[/\\]/).pop() || project.path;
            return (
              <Card
                key={index}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => openProject(project.path)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-5 h-5" />
                      {projectName}
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        project.trust_level === "trusted"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {project.trust_level}
                    </span>
                  </CardTitle>
                  <CardDescription>{project.path}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
