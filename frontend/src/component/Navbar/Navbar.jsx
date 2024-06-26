import React from 'react'
import './Navbar.css'
import { GiHamburgerMenu } from 'react-icons/gi'
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useStateContext } from '../../StateContext';

const navItems = ['Home', 'Product', 'About'];

const Navbar = () => {
  const [navActive, setNavActive] = React.useState(() => false);
  const { navRef } = useStateContext();

  return (
    <motion.nav
      ref={navRef}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}>
      <span id={'heading'}>
        <span>
          XV
        </span>
        Shop
      </span>

      <div
        id={navActive ? 'navitems-active' : 'navitems-inactive'}>
        <GiHamburgerMenu
          onClick={() => setNavActive(prev => !prev)}
          id={'GiHamburgerMenu'}
          style={{
            cursor: 'pointer',
            zIndex: 10,
            position: 'absolute',
            height: '25px',
            width: '25px',
            right: 10, top: 5
          }} />
        {navItems?.map((item, i) => <Link to={`/${item === "Home" ? '' : item}`} id='text' key={i}>{item}</Link>)}
      </div>

    </motion.nav>
  )
}

export default Navbar