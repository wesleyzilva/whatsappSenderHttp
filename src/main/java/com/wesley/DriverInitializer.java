package com.wesley;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.edge.EdgeDriver;
import org.openqa.selenium.edge.EdgeOptions;

public class DriverInitializer {
    private static final Logger logger = LogManager.getLogger(DriverInitializer.class);

    public static WebDriver initializeEdgeDriver(String edgeDriverPath) {
        try {
            // Configurar o driver do Edge
            System.setProperty("webdriver.edge.driver", edgeDriverPath);

            // Configurar as opções do Edge para modo de depuração
            EdgeOptions options = new EdgeOptions();
            options.setCapability("ms:edgeChromium", true);
            // options.setCapability("ms:edgeOptions", "debug");
            options.addArguments("--remote-allow-origins=*");
            // Configurar a codificação para o WebDriver
            options.addArguments("--encoding=UTF-8");

            WebDriver driver = new EdgeDriver(options);
            logger.info("EdgeDriver inicializado com sucesso");
            return driver;
        } catch (Exception e) {
            logger.error("Erro durante a inicialização do EdgeDriver: " + e.getMessage());
            return null; // Retorna null em caso de erro
        }
    }
}
