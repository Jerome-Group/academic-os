import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.file.FileSystemException;
import java.nio.file.Files;
import java.nio.file.Path;

class JavaBoundaryProbe {
  public static void main(String[] args) throws Exception {
    Files.writeString(Path.of(args[0], "owned-write"), "owned");
    System.out.println("OWNED_WRITE_PASSED");
    try {
      Files.writeString(Path.of(args[1], "must-not-exist"), "outside");
      throw new AssertionError("Outside write allowed");
    } catch (FileSystemException error) {
      if (!error.toString().contains("Operation not permitted")) throw error;
      System.out.println("OUTSIDE_WRITE_EPERM " + error);
    }
    try (ServerSocket listener = new ServerSocket(0)) {
      throw new AssertionError("TCP listener allowed");
    } catch (SocketException error) {
      if (!error.toString().contains("Operation not permitted")) throw error;
      System.out.println("LISTENER_EPERM " + error);
    }
    for (String host : new String[] { "1.1.1.1", "192.0.2.1" }) {
      try (Socket socket = new Socket()) {
        socket.connect(new InetSocketAddress(host, 443), 2000);
        throw new AssertionError("Outbound connection allowed " + host);
      } catch (SocketException error) {
        if (!error.toString().contains("Operation not permitted")) throw error;
        System.out.println("OUTBOUND_EPERM " + host + " " + error);
      }
    }
    System.out.println("BOUNDARY_CONTROLS_PASSED");
  }
}
