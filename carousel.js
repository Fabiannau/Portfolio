// Foto-Karussell Funktionalität für Projektseiten
class PhotoCarousel {
    constructor(projektNummer) {
        this.projektNummer = projektNummer;
        this.currentSlideIndex = 0;
        this.images = [];
        this.carouselContainer = null;
        
        this.init();
    }
    
    // Definiere verfügbare Bilder für jedes Projekt
    // Hier können später automatisch alle Bilder aus den Ordnern hinzugefügt werden
    getProjectImages() {
        const imageDatabase = {
            'projekt1': [
                'img/projekt1/35033f0c-9424-451a-b6f5-e71c84f66739.jpg',
                'img/projekt1/5713A1D6-4870-4543-A0BE-28B408F2C94D.jpg',
                'img/projekt1/6EF79BD2-A2C6-4E51-9D2A-AE21DE76774D.jpg',
                'img/projekt1/717f8699-b2ab-415e-b3fd-43c066f64785.jpg',
                'img/projekt1/98483362-f2ad-4e31-a4ef-c95f452a0f9f.jpg',
                'img/projekt1/a50a7622-9a5d-4448-a875-9177e0c0e978.jpg',
                'img/projekt1/CD363A0F-67EA-488F-89F8-B51DFF57CDC0.jpg',
                'img/projekt1/d7a8829d-24fc-4754-be96-8f2e2afdfe9c.jpg',
                'img/projekt1/fd7b7398-966d-48e0-9596-6a04cab5f142.jpg',
                'img/projekt1/IMG_20250319_235852758.jpg'
            ],
            'projekt2': [
                'img/projekt2/IMG_0031.jpg',
                'img/projekt2/IMG_0032.jpg',
                'img/projekt2/IMG_0143.jpg',
                'img/projekt2/IMG_0162.jpg',
                'img/projekt2/IMG_0169.jpg'
            ],
            'projekt3': [
                'img/projekt3/20241027_Helsinki_PP6_0529.jpeg',
                'img/projekt3/20241027_Helsinki_PP6_0545.jpeg',
                'img/projekt3/20241027_Helsinki_PP6_0571.jpeg'
            ],
            'projekt4': [
                'img/projekt4/IMG_8873.JPG',
                'img/projekt4/IMG_8877.JPG',
                'img/projekt4/IMG_8908.JPG',
                'img/projekt4/IMG_8924.JPG'
            ],
            'projekt5': [
                // 'img/projekt5/01-morgen-dreh.jpg'
            ],
            'projekt6': [
                // 'img/projekt6/01-kindheit-set.jpg'
            ]
        };
        
        return imageDatabase[this.projektNummer] || [];
    }
    
    init() {
        this.images = this.getProjectImages();
        this.createCarousel();
    }
    
    createCarousel() {
        const carouselElement = document.querySelector('.photo-carousel');
        if (!carouselElement) return;
        
        if (this.images.length === 0) {
            // Zeige Placeholder wenn keine Bilder vorhanden
            carouselElement.innerHTML = `
                <div class="photo-carousel-placeholder">
                    <p>Noch keine Fotos für dieses Projekt vorhanden<br>
                    <small>Bilder in den Ordner img/${this.projektNummer}/ legen und die Liste in carousel.js aktualisieren</small></p>
                </div>
            `;
            return;
        }
        
        // Erstelle Karussell mit Bildern
        const carouselHTML = `
            <div class="carousel-container">
                <div class="carousel-track" id="carousel-track">
                    ${this.images.map((img, index) => `
                        <div class="carousel-slide">
                            <img src="${img}" alt="Set Foto ${index + 1}" loading="lazy">
                        </div>
                    `).join('')}
                </div>
                <button class="carousel-nav carousel-prev" onclick="photoCarousel.moveCarousel(-1)">‹</button>
                <button class="carousel-nav carousel-next" onclick="photoCarousel.moveCarousel(1)">›</button>
                <div class="carousel-dots">
                    ${this.images.map((_, index) => `
                        <button class="carousel-dot ${index === 0 ? 'active' : ''}" onclick="photoCarousel.currentSlide(${index + 1})"></button>
                    `).join('')}
                </div>
            </div>
        `;
        
        carouselElement.innerHTML = carouselHTML;
        this.carouselContainer = document.getElementById('carousel-track');
    }
    
    moveCarousel(direction) {
        if (this.images.length === 0) return;
        
        this.currentSlideIndex += direction;
        
        if (this.currentSlideIndex >= this.images.length) {
            this.currentSlideIndex = 0;
        } else if (this.currentSlideIndex < 0) {
            this.currentSlideIndex = this.images.length - 1;
        }
        
        this.updateCarousel();
    }
    
    currentSlide(slideIndex) {
        if (this.images.length === 0) return;
        
        this.currentSlideIndex = slideIndex - 1;
        this.updateCarousel();
    }
    
    updateCarousel() {
        if (!this.carouselContainer) return;
        
        const translateX = -this.currentSlideIndex * 100;
        this.carouselContainer.style.transform = `translateX(${translateX}%)`;
        
        this.updateDots();
    }
    
    updateDots() {
        const dots = document.querySelectorAll('.carousel-dot');
        dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentSlideIndex);
        });
    }
}

// Globale Variable für einfachen Zugriff
let photoCarousel;
