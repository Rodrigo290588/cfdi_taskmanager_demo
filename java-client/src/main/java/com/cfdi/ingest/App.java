package com.cfdi.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.module.afterburner.AfterburnerModule;

import java.io.BufferedWriter;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

public class App {

    private static final String DEFAULT_BASE_URL = "http://localhost:3000";
    private static final String IMPORT_PATH = "/api/external/cfdi-import";
    private static final String TOKEN_PATH = "/api/oauth/token";
    private static final String DEFAULT_SCOPE = "cfdi.import";
    private static final String DEFAULT_SOURCE = "JAVA_M2M";
    private static final String DEFAULT_DIR = "xml-data";
    private static final int DEFAULT_BATCH_SIZE = 500;
    private static final int MAX_BATCH_SIZE = 500;
    private static final int SAFE_MAX_REQUEST_BODY_BYTES = 9 * 1024 * 1024;
    private static final String PROGRESS_FILE = "progress.log";
    private static final int MAX_SEND_RETRIES = 5;
    private static final long DEFAULT_RETRY_DELAY_MS = 1000L;
    private static final long SUCCESS_REQUEST_SPACING_MS = 300L;

    private static final HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    private static final ObjectMapper jsonMapper = new ObjectMapper()
            .registerModule(new AfterburnerModule());

    private static final Set<String> processedFiles = ConcurrentHashMap.newKeySet();
    private static final Path progressFilePath = resolveProgressFilePath();
    public static void main(String[] args) {
        CliConfig config;

        try {
            config = parseArgs(args);
        } catch (IllegalArgumentException e) {
            System.err.println("Argumentos inválidos: " + e.getMessage());
            printUsage();
            return;
        }

        if (config.showHelp()) {
            printUsage();
            return;
        }

        System.out.println("Iniciando cliente de ingesta CFDI M2M...");
        System.out.println("Base URL: " + config.baseUrl());
        System.out.println("Endpoint importación: " + buildImportUrl(config.baseUrl()));
        System.out.println("Scope solicitado: " + config.scope());

        String accessToken = requestAccessToken(config);
        if (accessToken == null || accessToken.isBlank()) {
            System.err.println("No fue posible obtener el token OAuth para realizar la importación.");
            return;
        }

        if (config.filePath() != null) {
            importSingleFile(config, accessToken);
            return;
        }

        importDirectory(config, accessToken);
    }

    private static CliConfig parseArgs(String[] args) {
        Map<String, String> options = new LinkedHashMap<>();

        for (int index = 0; index < args.length; index++) {
            String rawArg = args[index];
            if (!rawArg.startsWith("--")) {
                if (!options.containsKey("dir")) {
                    options.put("dir", rawArg);
                    continue;
                }

                throw new IllegalArgumentException("Parámetro posicional no reconocido: " + rawArg);
            }

            String option = rawArg.substring(2);
            String value;
            int equalsIndex = option.indexOf('=');

            if (equalsIndex >= 0) {
                value = option.substring(equalsIndex + 1);
                option = option.substring(0, equalsIndex);
            } else if (index + 1 < args.length && !args[index + 1].startsWith("--")) {
                value = args[++index];
            } else {
                value = "true";
            }

            options.put(normalizeOptionName(option), value);
        }

        boolean showHelp = isTrue(options.get("help"));
        String baseUrl = trimToNull(options.getOrDefault("base-url", DEFAULT_BASE_URL));
        String clientId = trimToNull(options.getOrDefault("client-id", System.getenv("CFDI_IMPORT_CLIENT_ID")));
        String clientSecret = trimToNull(options.getOrDefault("client-secret", System.getenv("CFDI_IMPORT_CLIENT_SECRET")));
        String scope = trimToNull(options.getOrDefault("scope", DEFAULT_SCOPE));
        String dir = trimToNull(options.getOrDefault("dir", DEFAULT_DIR));
        String filePath = trimToNull(options.get("file-path"));
        String fileName = trimToNull(options.get("file-name"));
        String batchId = trimToNull(options.get("batch-id"));
        int batchSize = parseBatchSize(options.get("batch-size"));
        boolean skipProgress = isTrue(options.get("skip-progress"));

        if (!showHelp && (clientId == null || clientSecret == null)) {
            throw new IllegalArgumentException("Debes indicar --client-id y --client-secret, o definir CFDI_IMPORT_CLIENT_ID y CFDI_IMPORT_CLIENT_SECRET.");
        }

        if (!showHelp && filePath == null && dir == null) {
            throw new IllegalArgumentException("Debes indicar --file-path para un XML específico o --dir para una carpeta.");
        }

        if (filePath != null) {
            dir = null;
        }

        return new CliConfig(
                showHelp,
                baseUrl,
                clientId,
                clientSecret,
                scope != null ? scope : DEFAULT_SCOPE,
                dir,
                filePath,
                fileName,
                batchId,
                batchSize,
                skipProgress
        );
    }

    private static String normalizeOptionName(String option) {
        return switch (option) {
            case "ruta-archivo" -> "file-path";
            case "nombre-archivo" -> "file-name";
            case "directorio" -> "dir";
            case "omitir-progreso" -> "skip-progress";
            case "ayuda" -> "help";
            default -> option;
        };
    }

    private static int parseBatchSize(String rawValue) {
        if (rawValue == null || rawValue.isBlank()) {
            return DEFAULT_BATCH_SIZE;
        }

        int value = Integer.parseInt(rawValue);
        if (value < 1 || value > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException("--batch-size debe estar entre 1 y " + MAX_BATCH_SIZE);
        }

        return value;
    }

    private static boolean isTrue(String value) {
        if (value == null) {
            return false;
        }

        return value.equalsIgnoreCase("true")
                || value.equalsIgnoreCase("1")
                || value.equalsIgnoreCase("yes")
                || value.equalsIgnoreCase("si");
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static void printUsage() {
        System.out.println("""
                Uso:
                  java -jar cfdi-ingest-1.0-SNAPSHOT.jar --client-id <id> --client-secret <secret> [opciones]

                Modos soportados:
                  1. Archivo único
                     --file-path "C:\\\\ruta\\\\mi-xml.xml"
                     --file-name "nombre-personalizado.xml"   (opcional)

                  2. Directorio completo
                     --dir "C:\\\\ruta\\\\carpeta-xml"

                Opciones:
                  --base-url <url>          Base de la app web. Default: http://localhost:3000
                  --scope <scope>           Scope OAuth. Default: cfdi.import
                  --batch-id <valor>        BatchId explícito para la corrida
                  --batch-size <1-500>      Tamaño de lote para directorio. Default: 500
                  --skip-progress           No usa progress.log para reintentos
                  --help                    Muestra esta ayuda

                Alias en español:
                  --ruta-archivo, --nombre-archivo, --directorio, --omitir-progreso, --ayuda

                Ejemplos:
                  java -jar cfdi-ingest-1.0-SNAPSHOT.jar --client-id demo-client --client-secret demo-secret --file-path "C:\\\\CFDI\\\\ejemplo.xml"
                  java -jar cfdi-ingest-1.0-SNAPSHOT.jar --client-id demo-client --client-secret demo-secret --file-path "C:\\\\CFDI\\\\ejemplo.xml" --file-name "mi-factura.xml"
                  java -jar cfdi-ingest-1.0-SNAPSHOT.jar --client-id demo-client --client-secret demo-secret --dir "C:\\\\CFDI\\\\lote"
                """);
    }

    private static void importSingleFile(CliConfig config, String accessToken) {
        Path path = Paths.get(config.filePath()).toAbsolutePath().normalize();
        if (!Files.exists(path) || !Files.isRegularFile(path)) {
            System.err.println("El archivo no existe o no es válido: " + path);
            return;
        }

        if (!path.toString().toLowerCase().endsWith(".xml")) {
            System.err.println("El archivo debe ser XML: " + path.getFileName());
            return;
        }

        try {
            FileRecord record = buildFileRecord(path, config.fileName());
            String batchId = config.batchId() != null ? config.batchId() : buildBatchId("single");
            ImportResult result = sendBatch(List.of(record), accessToken, config, batchId, null);

            if (result.success()) {
                System.out.println("Archivo enviado correctamente.");
                System.out.println("ImportRunId: " + result.importRunId());
                System.out.println("Estatus inicial: " + result.status());
            }
        } catch (Exception e) {
            System.err.println("No fue posible importar el archivo: " + e.getMessage());
        }
    }

    private static void importDirectory(CliConfig config, String accessToken) {
        Path dirPath = Paths.get(config.dir()).toAbsolutePath().normalize();
        System.out.println("Directorio objetivo: " + dirPath);

        if (!Files.exists(dirPath) || !Files.isDirectory(dirPath)) {
            System.err.println("El directorio no existe: " + dirPath);
            return;
        }

        if (!config.skipProgress()) {
            loadProgress();
            System.out.println("Archivos previamente procesados: " + processedFiles.size());
        }

        long startTime = System.currentTimeMillis();
        AtomicInteger processedCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);
        AtomicInteger totalXmlFiles = new AtomicInteger(0);
        AtomicInteger skippedByProgressFiles = new AtomicInteger(0);
        List<Path> pendingPaths = new ArrayList<>();

        try (Stream<Path> paths = Files.walk(dirPath)) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> path.toString().toLowerCase().endsWith(".xml"))
                    .forEach(path -> {
                        totalXmlFiles.incrementAndGet();
                        String absolutePath = path.toAbsolutePath().toString();
                        if (!config.skipProgress() && processedFiles.contains(absolutePath)) {
                            skippedByProgressFiles.incrementAndGet();
                            return;
                        }

                        pendingPaths.add(path.toAbsolutePath().normalize());
                    });
        } catch (Exception e) {
            System.err.println("Error recorriendo el directorio: " + e.getMessage());
            return;
        }

        DirectoryControl directoryControl = new DirectoryControl(
                buildBatchId("dir-exec"),
                totalXmlFiles.get(),
                skippedByProgressFiles.get(),
                pendingPaths.size()
        );

        System.out.println("XML detectados en directorio: " + directoryControl.totalXmlFiles());
        System.out.println("XML omitidos por progress.log: " + directoryControl.skippedByProgressFiles());
        System.out.println("XML nuevos a enviar: " + directoryControl.newXmlFiles());

        for (int startIndex = 0; startIndex < pendingPaths.size(); ) {
            List<FileRecord> batch = new ArrayList<>(config.batchSize());
            int endIndex = startIndex;
            int estimatedBatchBytes = estimateBatchBasePayloadBytes(directoryControl);

            while (endIndex < pendingPaths.size() && batch.size() < config.batchSize()) {
                Path path = pendingPaths.get(endIndex);
                try {
                    FileRecord record = buildFileRecord(path, null);
                    int estimatedRecordBytes = estimateRecordPayloadBytes(record);

                    if (!batch.isEmpty() && estimatedBatchBytes + estimatedRecordBytes > SAFE_MAX_REQUEST_BODY_BYTES) {
                        break;
                    }

                    batch.add(record);
                    estimatedBatchBytes += estimatedRecordBytes;
                } catch (Exception e) {
                    System.err.println("Error preparando " + path.getFileName() + ": " + e.getMessage());
                    errorCount.incrementAndGet();
                }

                endIndex++;
            }

            if (batch.isEmpty()) {
                startIndex = endIndex;
                continue;
            }

            String batchId = buildBatchId(endIndex >= pendingPaths.size() ? "dir-final" : "dir");
            System.out.println(
                    "Enviando lote de " + batch.size() + " XML(s) "
                            + "(estimado " + Math.round((estimatedBatchBytes / 1024d) * 100) / 100d + " KB)"
            );
            ImportResult result = sendBatch(batch, accessToken, config, batchId, directoryControl);
            if (result.success()) {
                int total = processedCount.addAndGet(batch.size());
                if (!config.skipProgress()) {
                    saveProgress(batch);
                }
                System.out.println("Total procesados: " + total + " | ImportRunId: " + result.importRunId());
            } else {
                errorCount.addAndGet(batch.size());
            }

            startIndex = endIndex;
        }

        long endTime = System.currentTimeMillis();
        System.out.println("Ingesta completada en " + (endTime - startTime) + "ms");
        System.out.println("Total nuevos procesados: " + processedCount.get());
        System.out.println("Errores de preparación/envío: " + errorCount.get());
    }

    private static FileRecord buildFileRecord(Path path, String overrideFileName) throws Exception {
        byte[] bytes = Files.readAllBytes(path);
        String fileName = trimToNull(overrideFileName);
        if (fileName == null) {
            fileName = path.getFileName().toString();
        }

        return new FileRecord(
                path.toAbsolutePath().normalize(),
                fileName,
                Base64.getEncoder().encodeToString(bytes),
                sha256Hex(bytes)
        );
    }

    private static String requestAccessToken(CliConfig config) {
        try {
            String body = "grant_type=client_credentials&scope="
                    + URLEncoder.encode(config.scope(), StandardCharsets.UTF_8);
            String basicAuth = Base64.getEncoder().encodeToString(
                    (config.clientId() + ":" + config.clientSecret()).getBytes(StandardCharsets.UTF_8)
            );

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(buildTokenUrl(config.baseUrl())))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Authorization", "Basic " + basicAuth)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                System.err.println("Error obteniendo token. HTTP " + response.statusCode() + ": " + response.body());
                return null;
            }

            JsonNode node = jsonMapper.readTree(response.body());
            String accessToken = node.path("access_token").asText(null);
            if (accessToken == null || accessToken.isBlank()) {
                System.err.println("La respuesta OAuth no devolvió access_token.");
                return null;
            }

            return accessToken;
        } catch (Exception e) {
            System.err.println("No fue posible obtener el token OAuth: " + e.getMessage());
            return null;
        }
    }

    private static ImportResult sendBatch(
            List<FileRecord> records,
            String accessToken,
            CliConfig config,
            String batchId,
            DirectoryControl directoryControl
    ) {
        int retries = MAX_SEND_RETRIES;
        long retryDelayMs = DEFAULT_RETRY_DELAY_MS;

        while (retries > 0) {
            try {
                ObjectNode payload = jsonMapper.createObjectNode();
                payload.put("batchId", batchId);
                payload.put("source", DEFAULT_SOURCE);

                if (directoryControl != null) {
                    ObjectNode directoryControlNode = payload.putObject("directoryControl");
                    directoryControlNode.put("executionId", directoryControl.executionId());
                    directoryControlNode.put("totalXmlFiles", directoryControl.totalXmlFiles());
                    directoryControlNode.put("skippedByProgressFiles", directoryControl.skippedByProgressFiles());
                    directoryControlNode.put("newXmlFiles", directoryControl.newXmlFiles());
                }

                ArrayNode items = payload.putArray("items");
                for (FileRecord record : records) {
                    ObjectNode item = items.addObject();
                    item.put("fileName", record.fileName());
                    item.put("contentBase64", record.contentBase64());
                    item.put("contentSha256", record.contentSha256());
                }

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(buildImportUrl(config.baseUrl())))
                        .timeout(Duration.ofMinutes(2))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + accessToken)
                        .POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(payload)))
                        .build();

                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    JsonNode responseNode = jsonMapper.readTree(response.body());
                    String importRunId = responseNode.path("importRunId").asText("");
                    String status = responseNode.path("status").asText("");
                    System.out.println("Lote enviado: " + records.size() + " archivo(s). HTTP " + response.statusCode());
                    sleepQuietly(SUCCESS_REQUEST_SPACING_MS);
                    return new ImportResult(true, importRunId, status);
                }

                System.err.println("Error HTTP " + response.statusCode() + " al enviar lote: " + response.body());
                if (response.statusCode() == 429) {
                    long headerDelay = parseRetryAfterMs(response);
                    retryDelayMs = Math.max(retryDelayMs, headerDelay);
                } else if (response.statusCode() >= 400 && response.statusCode() < 500) {
                    return new ImportResult(false, null, null);
                } else if (response.statusCode() >= 500) {
                    retryDelayMs = Math.min(retryDelayMs * 2, 15_000L);
                }
            } catch (Exception e) {
                System.err.println("Error de red enviando lote: " + e.getMessage());
                retryDelayMs = Math.min(retryDelayMs * 2, 15_000L);
            }

            retries--;
            if (retries > 0) {
                System.out.println("Reintentando envío (" + retries + " restantes) en " + retryDelayMs + " ms...");
                if (!sleepQuietly(retryDelayMs)) {
                    return new ImportResult(false, null, null);
                }
            }
        }

        return new ImportResult(false, null, null);
    }

    private static long parseRetryAfterMs(HttpResponse<String> response) {
        return response.headers()
                .firstValue("Retry-After")
                .map(value -> {
                    try {
                        return Math.max(1L, Long.parseLong(value.trim())) * 1000L;
                    } catch (NumberFormatException e) {
                        return DEFAULT_RETRY_DELAY_MS;
                    }
                })
                .orElse(DEFAULT_RETRY_DELAY_MS);
    }

    private static boolean sleepQuietly(long delayMs) {
        try {
            Thread.sleep(Math.max(0L, delayMs));
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static String buildBatchId(String prefix) {
        return prefix + "-" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(Instant.now().atZone(java.time.ZoneId.systemDefault()))
                + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static int estimateBatchBasePayloadBytes(DirectoryControl directoryControl) {
        int total = 2048;

        if (directoryControl != null) {
            total += directoryControl.executionId().getBytes(StandardCharsets.UTF_8).length;
            total += 128;
        }

        return total;
    }

    private static int estimateRecordPayloadBytes(FileRecord record) {
        return record.fileName().getBytes(StandardCharsets.UTF_8).length
                + record.contentBase64().length()
                + record.contentSha256().length()
                + 512;
    }

    private static String sha256Hex(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(bytes);
        StringBuilder builder = new StringBuilder(hash.length * 2);
        for (byte value : hash) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private static String buildImportUrl(String baseUrl) {
        return normalizeBaseUrl(baseUrl) + IMPORT_PATH;
    }

    private static String buildTokenUrl(String baseUrl) {
        return normalizeBaseUrl(baseUrl) + TOKEN_PATH;
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl.endsWith("/")) {
            return baseUrl.substring(0, baseUrl.length() - 1);
        }

        return baseUrl;
    }

    private static Path resolveProgressFilePath() {
        try {
            URI codeSource = App.class.getProtectionDomain().getCodeSource().getLocation().toURI();
            Path location = Paths.get(codeSource);
            Path baseDir = Files.isDirectory(location) ? location : location.getParent();
            return baseDir.resolve(PROGRESS_FILE).toAbsolutePath().normalize();
        } catch (Exception e) {
            return Paths.get(PROGRESS_FILE).toAbsolutePath().normalize();
        }
    }

    private static void loadProgress() {
        if (!Files.exists(progressFilePath)) {
            System.out.println("No se encontró archivo de progreso, iniciando desde cero.");
            return;
        }

        System.out.println("Cargando progreso desde: " + progressFilePath);
        try (Stream<String> lines = Files.lines(progressFilePath)) {
            lines.forEach(processedFiles::add);
        } catch (IOException e) {
            System.err.println("Error leyendo archivo de progreso: " + e.getMessage());
        }
    }

    private static void saveProgress(List<FileRecord> records) {
        try (BufferedWriter writer = Files.newBufferedWriter(
                progressFilePath,
                java.nio.file.StandardOpenOption.CREATE,
                java.nio.file.StandardOpenOption.APPEND
        )) {
            for (FileRecord record : records) {
                String absolutePath = record.path().toAbsolutePath().toString();
                writer.write(absolutePath);
                writer.newLine();
                processedFiles.add(absolutePath);
            }
        } catch (IOException e) {
            System.err.println("Error guardando progreso: " + e.getMessage());
        }
    }

    record FileRecord(Path path, String fileName, String contentBase64, String contentSha256) {}

    record ImportResult(boolean success, String importRunId, String status) {}

    record DirectoryControl(
            String executionId,
            int totalXmlFiles,
            int skippedByProgressFiles,
            int newXmlFiles
    ) {}

    record CliConfig(
            boolean showHelp,
            String baseUrl,
            String clientId,
            String clientSecret,
            String scope,
            String dir,
            String filePath,
            String fileName,
            String batchId,
            int batchSize,
            boolean skipProgress
    ) {}
}
