package com.wesley;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public class FileReader {
    private static final Logger logger = LogManager.getLogger(FileReader.class);

    public static List<String> readPhoneNumbers(String fileName) throws IOException {
        List<String> phoneNumbers = Files.readAllLines(Paths.get(fileName));
        logger.info("Leitura de telefones com sucesso");
        return phoneNumbers;
    }

    public static String readMessage(String fileName) throws IOException {
        String message = Files.readString(Paths.get(fileName));
        logger.info("Leitura de mensagem com sucesso");
        logger.always().log(message);
        return message;
    }
}
