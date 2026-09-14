/**
 * Reusable video upload / preview component for exercise forms.
 * Handles: select file, preview before save, upload to Convex storage,
 * replace existing video, and remove video.
 */
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Upload, X, Play, Video } from "lucide-react";
import { toast } from "sonner";

type Props = {
  /** Existing resolved video URL (from storage or external) */
  existingVideoUrl?: string | null;
  /** Called after a successful upload with the new storageId */
  onUploaded: (storageId: Id<"_storage">) => void;
  /** Called when the user wants to remove the current video */
  onRemove?: () => void;
  /** Whether a removal is in progress */
  isRemoving?: boolean;
};

const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ACCEPT_ATTR = ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm";

export default function VideoUpload({ existingVideoUrl, onUploaded, onRemove, isRemoving }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const generateUploadUrl = useMutation(api.exercises.generateUploadUrl);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Only MP4, MOV, and WEBM video files are supported");
      return;
    }

    // Revoke old preview URL to avoid memory leaks
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });
      if (!result.ok) throw new Error("Upload failed");
      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
      onUploaded(storageId);
      // Clear local preview – parent will show the confirmed video
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Video uploaded successfully");
    } catch {
      toast.error("Failed to upload video. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleCancelPreview = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // What to display in the preview area
  const displayUrl = previewUrl ?? existingVideoUrl;

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1.5">
        <Video className="w-4 h-4 text-primary" />
        Exercise Video
        <span className="text-muted-foreground font-normal text-xs ml-1">(Optional · MP4, MOV, WEBM)</span>
      </Label>

      {/* Preview area */}
      {displayUrl ? (
        <div className="relative rounded-xl overflow-hidden border border-border bg-black">
          <video
            src={displayUrl}
            controls
            className="w-full aspect-video object-contain"
            preload="metadata"
          />
          {/* Overlay badge for local preview */}
          {previewUrl && (
            <div className="absolute top-2 left-2 bg-yellow-500 text-black text-[11px] font-bold px-2 py-0.5 rounded-full">
              Preview – not saved yet
            </div>
          )}
        </div>
      ) : (
        <div
          className="w-full aspect-video rounded-xl border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Click to select a video file</p>
          <p className="text-xs text-muted-foreground">MP4 · MOV · WEBM</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {/* Select / Replace */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="cursor-pointer"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {existingVideoUrl || previewUrl ? "Replace Video" : "Select Video"}
        </Button>

        {/* Upload (only when a new file is staged) */}
        {selectedFile && (
          <>
            <Button
              type="button"
              size="sm"
              className="cursor-pointer"
              onClick={() => void handleUpload()}
              disabled={uploading}
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Uploading…" : `Upload "${selectedFile.name}"`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="cursor-pointer text-muted-foreground"
              onClick={handleCancelPreview}
              disabled={uploading}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
          </>
        )}

        {/* Remove existing video */}
        {existingVideoUrl && !selectedFile && onRemove && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="cursor-pointer text-destructive hover:text-destructive/80"
            onClick={onRemove}
            disabled={isRemoving}
          >
            <X className="w-3.5 h-3.5 mr-1" />
            {isRemoving ? "Removing…" : "Remove Video"}
          </Button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
