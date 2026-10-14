import unittest

from check_stock import inspect_page


class InspectPageTest(unittest.TestCase):
    def test_detects_available_product_from_button(self):
        page = """
            <html>
              <span id="productTitle">Producto de prueba</span>
              <div id="availability"><span>En stock</span></div>
              <input id="add-to-cart-button" type="submit">
            </html>
        """

        status, detail, title = inspect_page(page)

        self.assertEqual(status, "available")
        self.assertEqual(detail, "En stock")
        self.assertEqual(title, "Producto de prueba")

    def test_detects_unavailable_product_before_available_word(self):
        page = """
            <html>
              <span id="productTitle">Producto de prueba</span>
              <div id="availability">
                <script>const noisyText = "No debe aparecer";</script>
                <span>Actualmente no disponible.</span>
              </div>
            </html>
        """

        status, detail, _ = inspect_page(page)

        self.assertEqual(status, "unavailable")
        self.assertEqual(detail, "Actualmente no disponible")

    def test_treats_captcha_as_unknown(self):
        page = "<html><form action='/errors/validateCaptcha'></form></html>"

        status, _, _ = inspect_page(page)

        self.assertEqual(status, "unknown")

    def test_detects_amazon_out_of_stock_box(self):
        page = """
            <html>
              <div id="availability"><script>const setup = true;</script></div>
              <div id="outOfStock">
                <span>Agotado temporalmente.</span>
                Estamos trabajando para volver a tenerlo en stock.
              </div>
            </html>
        """

        status, detail, _ = inspect_page(page)

        self.assertEqual(status, "unavailable")
        self.assertIn("Agotado temporalmente", detail)


if __name__ == "__main__":
    unittest.main()
