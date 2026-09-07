import { Badge, Box, Button, Flex, Heading, Spinner, Text } from "@radix-ui/themes";
import { BookOpen, CheckCircle2, FileText, Play, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { type SampleEpisode, sampleEpisodes } from "../samples";
import type { SavedUpload } from "../storage";
import type { ReaderProgress } from "../types";

type SampleStats = {
  cues: number;
  duration: string;
};

type ContinueInfo = {
  title: string;
  subtitle: string;
  progress?: ReaderProgress;
  onResume: () => void;
};

export function Home({
  savedUploads,
  uploading,
  onOpenUpload,
  hasApiKey,
  loadingSampleSlug,
  sampleStats,
  sampleProgress,
  continueInfo,
  onOpenSettings,
  onSample,
  onUploadFile,
}: {
  savedUploads: SavedUpload[];
  uploading: boolean;
  onOpenUpload: (key: string) => void;
  hasApiKey: boolean;
  loadingSampleSlug: string;
  sampleStats: Record<string, SampleStats>;
  /** Keyed by `sample:${slug}`. */
  sampleProgress: Record<string, ReaderProgress>;
  continueInfo?: ContinueInfo;
  onOpenSettings: () => void;
  onSample: (sample: SampleEpisode) => void;
  onUploadFile: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file && !uploading && !loadingSampleSlug) onUploadFile(file);
  }

  return (
    <div className="home-shell">
      {continueInfo ? (
        <section className="continue-card" aria-label="Continue where you left off">
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Badge variant="soft" color="green">
                Continue reading
              </Badge>
              <Heading as="h2" size="5" mt="2">
                {continueInfo.title}
              </Heading>
              <Text size="2" color="gray" as="p">
                {continueInfo.subtitle}
              </Text>
            </Box>
            <Button size="3" disabled={uploading || Boolean(loadingSampleSlug)} onClick={continueInfo.onResume}>
              <Play size={16} />
              Continue
            </Button>
          </Flex>
        </section>
      ) : null}

      <section
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Upload a book or subtitles"
          disabled={uploading || Boolean(loadingSampleSlug)}
          accept=".epub,application/epub+zip,.vtt,.srt,text/vtt,application/x-subrip,text/plain"
          className="hidden-input"
          onChange={(event) => {
            handleFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <Flex direction="column" align="center" gap="2">
          {uploading ? <Spinner /> : <Upload size={22} />}
          <Text size="3" weight="bold">
            {uploading ? "Opening your file…" : "Read a book or your own subtitles"}
          </Text>
          <Text size="2" color="gray" align="center">
            Drop an .epub, .vtt or .srt file here. Click any word as you read to understand it in context.
          </Text>
          <Text size="1" color="gray">Files are saved in this browser. EPUB books must be DRM-free.</Text>
          <Button disabled={uploading || Boolean(loadingSampleSlug)} variant="soft" onClick={() => fileInputRef.current?.click()}>
            Choose file
          </Button>
        </Flex>
      </section>

      {savedUploads.length > 0 ? (
        <section className="home-band" aria-label="Your library">
          <Heading as="h2" size="5" mb="3">Your library</Heading>
          <div className="sample-grid">
            {savedUploads.map((upload) => {
              const progress = sampleProgress[upload.key];
              const ratio = progress?.totalCues ? Math.min(1, ((progress.cueIndex ?? 0) + 1) / progress.totalCues) : 0;
              return (
                <article className="sample-card" key={upload.key}>
                  <header className="sample-card-head">
                    <Badge color="gray" variant="soft">{upload.kind === "epub" ? <BookOpen size={13} /> : <FileText size={13} />}{upload.kind === "epub" ? "EPUB book" : "Subtitles"}</Badge>
                    {progress ? <Badge color="green" variant="surface">{Math.round(ratio * 100)}%</Badge> : null}
                  </header>
                  <Heading as="h3" size="4">{upload.displayTitle ?? upload.fileName}</Heading>
                  {upload.author ? <Text size="2" color="gray">{upload.author}</Text> : null}
                  <Button variant="surface" disabled={uploading || Boolean(loadingSampleSlug)} onClick={() => onOpenUpload(upload.key)}>
                    <BookOpen size={15} />{progress ? "Resume" : "Read"}
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="home-band">
        <div className="home-section-heading">
          <Box>
            <Heading as="h2" size="5">
              Start with a Zuidas episode
            </Heading>
            <Text color="gray" size="2">
              Educational samples from Zuidas season 1 are bundled so the app works without uploads.
            </Text>
          </Box>
          {hasApiKey ? (
            <Badge color="green" variant="surface">
              <CheckCircle2 size={13} />
              API key ready
            </Badge>
          ) : (
            <Button variant="soft" onClick={onOpenSettings}>
              Add API key
            </Button>
          )}
        </div>

        <div className="sample-grid">
          {sampleEpisodes.map((sample) => {
            const stats = sampleStats[sample.slug];
            const loading = loadingSampleSlug === sample.slug;
            const progress = sampleProgress[`sample:${sample.slug}`];
            const progressRatio =
              progress && progress.totalCues && progress.cueIndex !== undefined
                ? Math.min(1, (progress.cueIndex + 1) / progress.totalCues)
                : 0;
            return (
              <article className="sample-card" key={sample.slug}>
                <header className="sample-card-head">
                  <Badge color="gray" variant="soft">
                    S{sample.season} · E{sample.episode}
                  </Badge>
                  {progress ? (
                    <Badge color="green" variant="surface">
                      {Math.round(progressRatio * 100)}%
                    </Badge>
                  ) : null}
                </header>
                <Heading as="h3" size="4">
                  {sample.title}
                </Heading>
                <Text size="2" color="gray">
                  {stats ? `${stats.cues} cues · ${stats.duration}` : "Subtitle sample"}
                </Text>
                {progress ? <div className="sample-progress" style={{ ["--p" as string]: progressRatio }} /> : null}
                <Button variant="surface" onClick={() => onSample(sample)} disabled={uploading || Boolean(loadingSampleSlug)}>
                  {loading ? <Spinner /> : <Play size={15} />}
                  {progress ? "Resume" : "Start"}
                </Button>
              </article>
            );
          })}
        </div>
      </section>



    </div>
  );
}
