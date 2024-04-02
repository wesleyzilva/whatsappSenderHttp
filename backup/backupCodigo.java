package com.wesley;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.openqa.selenium.By;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.edge.EdgeDriver;
import org.openqa.selenium.edge.EdgeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.util.Scanner;

public class App {
    private static final Logger logger = LogManager.getLogger(App.class);

    public static void main(String[] args) {
        try {
            List<String> phoneNumbers = Files.readAllLines(Paths.get("telefones.txt"));
            logger.info("Leitura de telefones com sucesso");
            String message = Files.readString(Paths.get("mensagem.txt"));
            logger.info("Leitura de mensagem com sucesso");
            logger.always().log(message);
            // Configurar o driver do Edge
            System.setProperty("webdriver.edge.driver", "C:\\dev\\edgedriver\\msedgedriver.exe");

            // Configurar as opções do Edge para modo de depuração
            EdgeOptions options = new EdgeOptions();
            options.setCapability("ms:edgeChromium", true);
            // options.setCapability("ms:edgeOptions", "debug");
            options.addArguments("--remote-allow-origins=*");
            WebDriver driver = new EdgeDriver(options);
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            logger.info("EdgeDriver");
            driver.manage().window().maximize();

            // Definir o tempo de espera máximo para 30 segundos
            WebDriverWait wait = new WebDriverWait(driver, 30);

            // Navegar para cada URL e aguardar a página carregar
            for (String phoneNumber : phoneNumbers) {
                String url = "https://api.whatsapp.com/send?phone=" + phoneNumber + "&text=" + message;
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                logger.info("Navegando para: {}", url);
                driver.get(url);

                // Aguardar até que a classe "_9vcv" esteja presente
                try {
                    WebElement element = wait.until(ExpectedConditions.presenceOfElementLocated(By.className("_9vcv")));
                    logger.info(driver.getCurrentUrl());
                    logger.info(driver.getCurrentUrl());
                    logger.info(driver.getCurrentUrl());
                    logger.info(driver.getCurrentUrl());

                    logger.info(element);
                    logger.info(element);
                    logger.info(element);
                    logger.info(element);
                    logger.info(element);
                    logger.info(element);
                    logger.info(element);
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");
                    logger.info("Classe '_9vcv' encontrada. Iniciando conversa...");

                    // Clicar no botão "iniciar conversa"
                    WebElement startChatButton = driver.findElement(By.xpath("//a[contains(@class,'_3b3-3')]"));
                    startChatButton.click();

                    logger.info("Botão 'iniciar conversa' clicado.");
                } catch (NoSuchElementException e) {
                    logger.error("Classe '_9vcv' não encontrada. Verifique sua conexão ou o HTML da página.");
                }

                // Exemplo de log
                logger.info("Navegação concluída para: {}", url);

            }
//            waitForEnter();
            // Fechar o navegador ao finalizar
            driver.quit();
            // Mensagem de finalização de execução
            logger.info("Execução finalizada. Pressione Enter para sair...");
//            waitForEnter();
        } catch (IOException e) {
            logger.error("Erro durante a execução: {}", e.getMessage());
        }
    }

    // Método para aguardar até que o usuário pressione "Enter"
    private static void waitForEnter() {
        logger.info("Pressione Enter para fechar o navegador...");
        Scanner scanner = new Scanner(System.in);
        scanner.nextLine();
    }
}
