export const CHUNK_SIZE = 8 * 1024 * 1024;

export async function prepareUploadFile(file: File): Promise<File> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const type = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[extension ?? ""] || "";
  if (type === "image/jpeg") return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  if (type === "image/png" || type === "image/webp") {
    if (file.size > 25 * 1024 * 1024) throw new Error("A imagem original pode ter até 25 MB antes da conversão.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu preparar essa imagem.");
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível converter a imagem para JPEG.")), "image/jpeg", 0.92);
      });
      const baseName = file.name.replace(/\.[^.]+$/, "") || "imagem";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } finally {
      bitmap.close();
    }
  }
  if (type === "video/mp4" || type === "video/quicktime") return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  if (extension === "mp4" || extension === "mov") {
    return new File([file], file.name, { type: extension === "mov" ? "video/quicktime" : "video/mp4", lastModified: file.lastModified });
  }
  throw new Error("Use uma imagem JPG, PNG ou WebP, ou um vídeo MP4/MOV.");
}

export async function validateReelFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível ler os dados deste vídeo."));
    });
    if (!Number.isFinite(video.duration) || video.duration < 3 || video.duration > 15 * 60) {
      throw new Error("O Reel precisa ter entre 3 segundos e 15 minutos.");
    }
    if (video.videoWidth > 1920) throw new Error("A largura do vídeo precisa ser de até 1.920 pixels.");
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
