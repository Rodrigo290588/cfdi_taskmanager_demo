package com.cfdi.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.module.afterburner.AfterburnerModule;
import com.fasterxml.jackson.dataformat.xml.XmlMapper;

import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

public class App {

    private static final String API_URL = "http://localhost:3000/api/import";
    private static final int BATCH_SIZE = 1000;
    private static final String PROGRESS_FILE = "progress.log";
    
    // Cliente HTTP/1.1 para evitar problemas de upgrade
    private static final HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
            
    // Jackson JSON mapper
    private static final ObjectMapper jsonMapper = new ObjectMapper()
            .registerModule(new AfterburnerModule());

    // Jackson XML mapper
    private static final XmlMapper xmlMapper = new XmlMapper();
    static {
        xmlMapper.registerModule(new AfterburnerModule());
    }

    // Set concurrente para seguimiento de archivos procesados
    private static final Set<String> processedFiles = ConcurrentHashMap.newKeySet();

    // Semáforo para limitar la concurrencia de operaciones de E/S (evitar "Too many open files")
    private static final java.util.concurrent.Semaphore ioSemaphore = new java.util.concurrent.Semaphore(100);

    public static void main(String[] args) {
        String dirPath = args.length > 0 ? args[0] : "xml-data";
        System.out.println("Iniciando cliente de ingesta CFDI (Java 21 + Virtual Threads)...");
        System.out.println("Directorio objetivo: " + dirPath);

        // 1. Cargar progreso previo
        loadProgress();
        System.out.println("Archivos previamente procesados: " + processedFiles.size());

        long startTime = System.currentTimeMillis();
        AtomicInteger processedCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);

        // Lista sincronizada para acumular pares (Path, Datos)
        List<FileRecord> batch = Collections.synchronizedList(new ArrayList<>(BATCH_SIZE));

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            if (!Files.exists(Paths.get(dirPath))) {
                System.err.println("El directorio no existe: " + dirPath);
                return;
            }

            try (Stream<Path> paths = Files.walk(Paths.get(dirPath))) {
                paths.filter(Files::isRegularFile)
                     .filter(p -> p.toString().toLowerCase().endsWith(".xml"))
                     .forEach(path -> {
                         String absPath = path.toAbsolutePath().toString();
                         // System.out.println("Encontrado: " + path);
                         // Verificar si ya fue procesado
                         if (processedFiles.contains(absPath)) {
                             // System.out.println("Saltando (ya procesado): " + path);
                             return; // Skip
                         }

                         executor.submit(() -> {
                             try {
                                 ioSemaphore.acquire();
                                 try {
                                     // System.out.println("Iniciando tarea para: " + path);
                                     ObjectNode data = parseXml(path);
                                     if (data != null) {
                                         addToBatch(new FileRecord(path, data), batch, processedCount);
                                     } else {
                                         System.err.println("Datos nulos/incompletos al parsear: " + path.getFileName());
                                         errorCount.incrementAndGet();
                                     }
                                 } finally {
                                     ioSemaphore.release();
                                 }
                             } catch (InterruptedException ie) {
                                 Thread.currentThread().interrupt();
                             } catch (Exception e) {
                                 System.err.println("Error procesando " + path + ": " + e.getMessage());
                                 errorCount.incrementAndGet();
                             }
                         });
                     });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Enviar remanente final
        System.out.println("Procesamiento finalizado. Enviando remanentes...");
        synchronized (batch) {
            if (!batch.isEmpty()) {
                System.out.println("Enviando lote final: " + batch.size());
                sendBatch(new ArrayList<>(batch));
            } else {
                System.out.println("No hay lote final.");
            }
        }

        long endTime = System.currentTimeMillis();
        System.out.println("Ingesta completada en " + (endTime - startTime) + "ms");
        System.out.println("Total nuevos procesados: " + processedCount.get());
        System.out.println("Errores de lectura/parseo: " + errorCount.get());
    }

    // Estructura auxiliar para mantener relación archivo-datos
    record FileRecord(Path path, ObjectNode data) {}

    private static void addToBatch(FileRecord record, List<FileRecord> batch, AtomicInteger counter) {
        List<FileRecord> toSend = null;
        synchronized (batch) {
            batch.add(record);
            if (batch.size() >= BATCH_SIZE) {
                toSend = new ArrayList<>(batch);
                batch.clear();
            }
        }
        
        if (toSend != null) {
            if (sendBatch(toSend)) {
                int total = counter.addAndGet(toSend.size());
                System.out.println("Total procesados: " + total);
            }
        }
    }

    private static ObjectNode parseXml(Path path) throws Exception {
        try (InputStream is = new FileInputStream(path.toFile())) {
            // Leer todo el XML a un árbol JSON
            JsonNode root = xmlMapper.readTree(is);
            
            // Buscar campos clave recursivamente si no están en la raíz
            String uuid = findValue(root, "UUID");
            if (uuid == null) uuid = findValue(root, "uuid");
            
            String rfcEmisor = findValue(root, "Rfc");
            if (rfcEmisor == null) rfcEmisor = findValue(root, "rfc");
            
            String fecha = findValue(root, "Fecha");
            if (fecha == null) fecha = findValue(root, "fecha");
            
            // Validar requeridos
            if (uuid != null && rfcEmisor != null) {
                ObjectNode result;
                if (root instanceof ObjectNode) {
                    result = (ObjectNode) root;
                } else {
                    result = jsonMapper.createObjectNode();
                    result.set("xml_content", root);
                }
                
                // Asegurar que los campos clave estén en la raíz para la API
                result.put("uuid", uuid);
                result.put("rfc_emisor", rfcEmisor);
                result.put("fecha", fecha);
                result.put("source_file", path.getFileName().toString());
                
                return result;
            }
        }
        return null;
    }
    
    // Búsqueda recursiva simple (depth-first)
    private static String findValue(JsonNode node, String key) {
        if (node.has(key)) return node.get(key).asText();
        if (node.has("@" + key)) return node.get("@" + key).asText(); // Atributos a veces tienen @
        
        for (JsonNode child : node) {
            if (child.isObject() || child.isArray()) {
                String found = findValue(child, key);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static boolean sendBatch(List<FileRecord> records) {
        // Extraer solo los datos JSON para enviar
        List<ObjectNode> jsonPayload = records.stream().map(FileRecord::data).toList();
        
        int retries = 3;
        while (retries > 0) {
            try {
                String json = jsonMapper.writeValueAsString(jsonPayload);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(API_URL))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json))
                        .build();

                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    System.out.println("Lote enviado: " + records.size() + " registros. Resp: " + response.statusCode());
                    // Guardar progreso tras éxito
                    saveProgress(records);
                    return true;
                } else {
                    System.out.println("Error HTTP " + response.statusCode() + ": " + response.body());
                }
            } catch (Exception e) {
                System.out.println("Error de red enviando lote: " + e.getMessage());
            }
            
            retries--;
            if (retries > 0) {
                System.out.println("Reintentando envío (" + retries + " restantes)...");
                try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
            }
        }
        System.out.println("Fallo al enviar lote tras 3 intentos.");
        return false;
    }

    private static void loadProgress() {
        Path path = Paths.get(PROGRESS_FILE);
        if (Files.exists(path)) {
            System.out.println("Cargando progreso desde: " + path.toAbsolutePath());
            try (Stream<String> lines = Files.lines(path)) {
                lines.forEach(processedFiles::add);
            } catch (IOException e) {
                System.err.println("Error leyendo archivo de progreso: " + e.getMessage());
            }
        } else {
            System.out.println("No se encontró archivo de progreso, iniciando desde cero.");
        }
    }

    private static void saveProgress(List<FileRecord> records) {
        // Escribir de forma segura (append)
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(PROGRESS_FILE, true))) {
            for (FileRecord record : records) {
                String absPath = record.path().toAbsolutePath().toString();
                writer.write(absPath);
                writer.newLine();
                processedFiles.add(absPath); // Actualizar set en memoria también
            }
        } catch (IOException e) {
            System.err.println("Error guardando progreso: " + e.getMessage());
        }
    }
}